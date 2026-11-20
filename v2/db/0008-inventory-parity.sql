BEGIN;

-- V2 lot provenance starts from the V2 on-hand projection only. No V1
-- quantities or movement history are read or copied.
CREATE TABLE v2.inventory_lots (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  lot_number text NOT NULL DEFAULT '' CHECK (
    length(lot_number) <= 120 AND lot_number !~ '[[:cntrl:]]'
  ),
  source_reference text NOT NULL DEFAULT '' CHECK (
    length(source_reference) <= 200 AND source_reference !~ '[[:cntrl:]]'
  ),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  quantity_received numeric(20,6) NOT NULL CHECK (quantity_received > 0),
  quantity_remaining numeric(20,6) NOT NULL CHECK (
    quantity_remaining >= 0 AND quantity_remaining <= quantity_received
  ),
  source_lot_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, id, warehouse_id, product_id),
  FOREIGN KEY (facility_id, warehouse_id, product_id)
    REFERENCES v2.inventory_balances (facility_id, warehouse_id, product_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, source_lot_id)
    REFERENCES v2.inventory_lots (facility_id, id) ON DELETE RESTRICT
);

CREATE INDEX inventory_lots_available_fifo
  ON v2.inventory_lots (facility_id, warehouse_id, product_id, received_at, id)
  WHERE quantity_remaining > 0;

ALTER TABLE v2.inventory_movements
  ADD COLUMN lot_number text NOT NULL DEFAULT '',
  ADD COLUMN source_reference text NOT NULL DEFAULT '',
  ADD COLUMN planned_product_id uuid,
  DROP CONSTRAINT inventory_movements_movement_type_check,
  ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN (
      'receipt', 'adjustment', 'transfer_out', 'transfer_in', 'opening_count',
      'run_consumption', 'cycle_count', 'prep_consume', 'prep_receive'
    ));

CREATE TABLE v2.inventory_movement_lot_allocations (
  facility_id uuid NOT NULL,
  movement_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity_delta numeric(20,6) NOT NULL CHECK (quantity_delta <> 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, movement_id, lot_id),
  FOREIGN KEY (facility_id, movement_id)
    REFERENCES v2.inventory_movements (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, lot_id, warehouse_id, product_id)
    REFERENCES v2.inventory_lots (facility_id, id, warehouse_id, product_id) ON DELETE RESTRICT
);

CREATE TRIGGER inventory_lot_allocations_append_only
  BEFORE UPDATE OR DELETE ON v2.inventory_movement_lot_allocations
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

-- Keep compatibility with V2 rows that existed before lot tracking began by
-- opening one explicitly identified V2 carry-forward lot per positive balance.
INSERT INTO v2.inventory_lots (
  facility_id, warehouse_id, product_id, lot_number, source_reference,
  quantity_received, quantity_remaining
)
SELECT facility_id, warehouse_id, product_id, 'V2-LOT-TRACKING-START',
  'V2 balance present when lot tracking was enabled', quantity, quantity
FROM v2.inventory_balances
WHERE quantity > 0;

CREATE FUNCTION v2.track_inventory_movement_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_remaining numeric(20,6) := abs(NEW.quantity_delta);
  v_take numeric(20,6);
  v_source record;
  v_lot_id uuid;
  v_now timestamptz := COALESCE(NEW.occurred_at, clock_timestamp());
BEGIN
  IF NEW.quantity_delta > 0 THEN
    IF NEW.movement_type = 'transfer_in' THEN
      FOR v_source IN
        SELECT a.lot_id, abs(a.quantity_delta) AS quantity,
          l.lot_number, l.source_reference, l.received_at
        FROM v2.inventory_movements outgoing
        JOIN v2.inventory_movement_lot_allocations a
          ON a.facility_id = outgoing.facility_id AND a.movement_id = outgoing.id
        JOIN v2.inventory_lots l
          ON l.facility_id = a.facility_id AND l.id = a.lot_id
        WHERE outgoing.facility_id = NEW.facility_id
          AND outgoing.movement_group_id = NEW.movement_group_id
          AND outgoing.movement_type = 'transfer_out'
          AND outgoing.quantity_delta < 0
        ORDER BY l.received_at, l.id
      LOOP
        v_take := LEAST(v_remaining, v_source.quantity);
        EXIT WHEN v_take <= 0;
        INSERT INTO v2.inventory_lots (
          facility_id, warehouse_id, product_id, lot_number, source_reference,
          received_at, quantity_received, quantity_remaining, source_lot_id, created_at
        ) VALUES (
          NEW.facility_id, NEW.warehouse_id, NEW.product_id,
          v_source.lot_number, v_source.source_reference, v_source.received_at,
          v_take, v_take, v_source.lot_id, v_now
        ) RETURNING id INTO v_lot_id;
        INSERT INTO v2.inventory_movement_lot_allocations (
          facility_id, movement_id, lot_id, warehouse_id, product_id, quantity_delta, created_at
        ) VALUES (
          NEW.facility_id, NEW.id, v_lot_id, NEW.warehouse_id, NEW.product_id, v_take, v_now
        );
        v_remaining := v_remaining - v_take;
      END LOOP;
      IF v_remaining <> 0 THEN
        RAISE EXCEPTION 'Transfer source lot details are incomplete' USING ERRCODE = '23514';
      END IF;
    ELSE
      INSERT INTO v2.inventory_lots (
        facility_id, warehouse_id, product_id, lot_number, source_reference,
        received_at, quantity_received, quantity_remaining, created_at
      ) VALUES (
        NEW.facility_id, NEW.warehouse_id, NEW.product_id, NEW.lot_number,
        NEW.source_reference, v_now, NEW.quantity_delta, NEW.quantity_delta, v_now
      ) RETURNING id INTO v_lot_id;
      INSERT INTO v2.inventory_movement_lot_allocations (
        facility_id, movement_id, lot_id, warehouse_id, product_id, quantity_delta, created_at
      ) VALUES (
        NEW.facility_id, NEW.id, v_lot_id, NEW.warehouse_id, NEW.product_id,
        NEW.quantity_delta, v_now
      );
    END IF;
    RETURN NEW;
  END IF;

  FOR v_source IN
    SELECT l.id, l.quantity_remaining
    FROM v2.inventory_lots l
    WHERE l.facility_id = NEW.facility_id
      AND l.warehouse_id = NEW.warehouse_id
      AND l.product_id = NEW.product_id
      AND l.quantity_remaining > 0
    ORDER BY l.received_at, l.id
    FOR UPDATE
  LOOP
    v_take := LEAST(v_remaining, v_source.quantity_remaining);
    EXIT WHEN v_take <= 0;
    UPDATE v2.inventory_lots
      SET quantity_remaining = quantity_remaining - v_take
      WHERE facility_id = NEW.facility_id AND id = v_source.id;
    INSERT INTO v2.inventory_movement_lot_allocations (
      facility_id, movement_id, lot_id, warehouse_id, product_id, quantity_delta, created_at
    ) VALUES (
      NEW.facility_id, NEW.id, v_source.id, NEW.warehouse_id, NEW.product_id,
      -v_take, v_now
    );
    v_remaining := v_remaining - v_take;
    EXIT WHEN v_remaining = 0;
  END LOOP;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Insufficient lot quantity for inventory movement' USING ERRCODE = '22003';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER inventory_movement_lot_tracking
  AFTER INSERT ON v2.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION v2.track_inventory_movement_lots();

CREATE TABLE v2.inventory_cycle_counts (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  rows jsonb NOT NULL CHECK (
    jsonb_typeof(rows) = 'array' AND jsonb_array_length(rows) BETWEEN 1 AND 2000
  ),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'reviewed', 'applied', 'stale')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  applied_by uuid,
  applied_at timestamptz,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, request_id),
  FOREIGN KEY (facility_id, warehouse_id)
    REFERENCES v2.inventory_warehouses (facility_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'staged' AND reviewed_at IS NULL)
    OR (status IN ('reviewed', 'applied') AND reviewed_at IS NOT NULL)
    OR status = 'stale'
  ),
  CHECK ((status = 'applied') = (applied_at IS NOT NULL)),
  CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
  CHECK ((applied_at IS NULL) = (applied_by IS NULL))
);

CREATE UNIQUE INDEX inventory_cycle_counts_one_pending
  ON v2.inventory_cycle_counts (facility_id, warehouse_id)
  WHERE status IN ('staged', 'reviewed');

CREATE TRIGGER inventory_cycle_counts_append_only
  BEFORE DELETE ON v2.inventory_cycle_counts
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE TABLE v2.setup_ingredient_inventory_links (
  facility_id uuid NOT NULL,
  ingredient_code text NOT NULL,
  product_id uuid NOT NULL,
  stock_units_per_lb numeric(20,8) NOT NULL CHECK (stock_units_per_lb > 0),
  actor_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, ingredient_code),
  FOREIGN KEY (facility_id, ingredient_code)
    REFERENCES v2.setup_ingredient_records (facility_id, code) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v2.setup_mix_inventory_links (
  facility_id uuid NOT NULL,
  mix_code text NOT NULL,
  product_id uuid NOT NULL,
  stock_units_per_lb numeric(20,8) NOT NULL CHECK (stock_units_per_lb > 0),
  actor_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, mix_code),
  FOREIGN KEY (facility_id, mix_code)
    REFERENCES v2.setup_mix_records (facility_id, code) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT
);

CREATE TABLE v2.inventory_preparations (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mix_code text NOT NULL,
  source_warehouse_id uuid NOT NULL,
  output_warehouse_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_id text NOT NULL CHECK (length(btrim(command_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  batch_count numeric(20,6) NOT NULL CHECK (batch_count > 0),
  prepared_product_id uuid NOT NULL,
  prepared_quantity numeric(20,6) NOT NULL CHECK (prepared_quantity > 0),
  lot_number text NOT NULL DEFAULT '',
  source_reference text NOT NULL DEFAULT '',
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, command_id),
  FOREIGN KEY (facility_id, mix_code)
    REFERENCES v2.setup_mix_records (facility_id, code) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, source_warehouse_id)
    REFERENCES v2.inventory_warehouses (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, output_warehouse_id)
    REFERENCES v2.inventory_warehouses (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, prepared_product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER inventory_preparations_append_only
  BEFORE UPDATE OR DELETE ON v2.inventory_preparations
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE TABLE v2.run_inventory_staged_supplies (
  facility_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  planned_product_id uuid NOT NULL,
  actual_product_id uuid NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL,
  command_id text NOT NULL CHECK (length(btrim(command_id)) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, id),
  UNIQUE (facility_id, actor_id, command_id),
  FOREIGN KEY (facility_id, run_id) REFERENCES v2.runs (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, warehouse_id) REFERENCES v2.inventory_warehouses (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, planned_product_id) REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, actual_product_id) REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER run_inventory_staged_supplies_append_only
  BEFORE UPDATE OR DELETE ON v2.run_inventory_staged_supplies
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE TABLE v2.run_inventory_stage_receipts (
  facility_id uuid NOT NULL,
  staged_supply_id uuid NOT NULL,
  actual_product_id uuid NOT NULL,
  quantity_used numeric(20,6) NOT NULL CHECK (quantity_used >= 0),
  quantity_released numeric(20,6) NOT NULL CHECK (quantity_released >= 0),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (facility_id, staged_supply_id),
  FOREIGN KEY (facility_id, staged_supply_id)
    REFERENCES v2.run_inventory_staged_supplies (facility_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (facility_id, actual_product_id)
    REFERENCES v2.products (facility_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER run_inventory_stage_receipts_append_only
  BEFORE UPDATE OR DELETE ON v2.run_inventory_stage_receipts
  FOR EACH ROW EXECUTE FUNCTION v2.reject_immutable_row_mutation();

CREATE OR REPLACE FUNCTION v2.list_inventory_stock(p_facility_id uuid, p_warehouse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid inventory scope' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  ) THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'productId', p.id, 'code', p.code, 'name', p.name, 'unit', p.base_unit,
      'quantity', COALESCE(b.quantity, 0)::text,
      'revision', COALESCE(b.revision, 0),
      'lotQuantity', COALESCE((
        SELECT sum(l.quantity_remaining) FROM v2.inventory_lots l
        WHERE l.facility_id = p.facility_id AND l.warehouse_id = p_warehouse_id
          AND l.product_id = p.id
      ), 0)::text,
      'stagedQuantity', COALESCE((
        SELECT sum(s.quantity)
        FROM v2.run_inventory_staged_supplies s
        JOIN v2.runs r ON r.facility_id = s.facility_id AND r.id = s.run_id
        WHERE s.facility_id = p.facility_id AND s.warehouse_id = p_warehouse_id
          AND s.actual_product_id = p.id AND r.status <> 'completed'
      ), 0)::text,
      'availableQuantity', (
        COALESCE(b.quantity, 0) - COALESCE((
          SELECT sum(s.quantity)
          FROM v2.run_inventory_staged_supplies s
          JOIN v2.runs r ON r.facility_id = s.facility_id AND r.id = s.run_id
          WHERE s.facility_id = p.facility_id AND s.warehouse_id = p_warehouse_id
            AND s.actual_product_id = p.id AND r.status <> 'completed'
        ), 0)
      )::text
    ) ORDER BY lower(p.name), p.id)
    FROM v2.products p
    LEFT JOIN v2.inventory_balances b
      ON b.facility_id = p.facility_id AND b.product_id = p.id AND b.warehouse_id = p_warehouse_id
    WHERE p.facility_id = p_facility_id AND p.active
  ), '[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION v2.list_inventory_movements(
  p_facility_id uuid, p_warehouse_id uuid, p_limit integer,
  p_before_at timestamptz, p_before_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR ((p_before_at IS NULL) <> (p_before_id IS NULL))
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid inventory history request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active
  ) THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  RETURN (
    WITH page AS (
      SELECT m.*, p.code AS product_code, p.name AS product_name, p.base_unit,
        row_number() OVER (ORDER BY m.occurred_at DESC, m.id DESC) AS row_num
      FROM v2.inventory_movements m
      JOIN v2.products p ON p.facility_id = m.facility_id AND p.id = m.product_id
      WHERE m.facility_id = p_facility_id AND m.warehouse_id = p_warehouse_id
        AND (p_before_at IS NULL OR (m.occurred_at, m.id) < (p_before_at, p_before_id))
      ORDER BY m.occurred_at DESC, m.id DESC
      LIMIT p_limit + 1
    )
    SELECT jsonb_build_object(
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', page.id, 'movementGroupId', page.movement_group_id,
          'productCode', page.product_code, 'productName', page.product_name,
          'unit', page.base_unit, 'type', page.movement_type,
          'quantityDelta', page.quantity_delta::text, 'reason', page.reason,
          'actorId', page.actor_id, 'occurredAt', page.occurred_at,
          'lotNumber', page.lot_number, 'sourceReference', page.source_reference,
          'plannedProductId', page.planned_product_id,
          'lotAllocations', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'lotId', a.lot_id, 'lotNumber', l.lot_number,
              'quantityDelta', a.quantity_delta::text
            ) ORDER BY l.received_at, l.id)
            FROM v2.inventory_movement_lot_allocations a
            JOIN v2.inventory_lots l ON l.facility_id = a.facility_id AND l.id = a.lot_id
            WHERE a.facility_id = page.facility_id AND a.movement_id = page.id
          ), '[]'::jsonb)
        ) ORDER BY page.row_num)
        FROM page WHERE page.row_num <= p_limit
      ), '[]'::jsonb),
      'nextCursor', CASE WHEN EXISTS (SELECT 1 FROM page WHERE row_num > p_limit) THEN (
        SELECT jsonb_build_object('occurredAt', occurred_at, 'id', id)
        FROM page WHERE row_num = p_limit
      ) ELSE NULL END
    )
  );
END
$$;

CREATE FUNCTION v2.list_inventory_lots(p_facility_id uuid, p_warehouse_id uuid, p_product_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_warehouse_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Invalid inventory scope' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active) THEN
    RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN COALESCE((
     SELECT jsonb_agg(jsonb_build_object(
      'id', l.id, 'productId', l.product_id, 'productCode', p.code,
      'productName', p.name, 'unit', p.base_unit, 'lotNumber', l.lot_number,
      'sourceReference', l.source_reference, 'receivedAt', l.received_at,
      'quantityReceived', l.quantity_received::text,
      'quantityRemaining', l.quantity_remaining::text,
      'sourceLotId', l.source_lot_id
     ) ORDER BY l.received_at DESC, l.id DESC)
     FROM (SELECT * FROM v2.inventory_lots
       WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id
         AND (p_product_id IS NULL OR product_id = p_product_id)
       ORDER BY received_at DESC, id DESC LIMIT p_limit) l
    JOIN v2.products p ON p.facility_id = l.facility_id AND p.id = l.product_id
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.record_inventory_movement_internal(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_warehouse_id uuid, p_product_code text, p_movement_type text,
  p_quantity numeric, p_reason text, p_lot_number text, p_source_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_hash text;
  v_response jsonb;
  v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE;
  v_available numeric(20,6);
  v_reserved numeric(20,6);
  v_now timestamptz;
  v_group_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
      OR p_movement_type NOT IN ('receipt', 'adjustment', 'prep_consume', 'prep_receive')
     OR p_quantity IS NULL OR p_quantity = 0 OR abs(p_quantity) >= 100000000000000
     OR (p_movement_type = 'receipt' AND p_quantity <= 0)
      OR (p_movement_type = 'prep_consume' AND p_quantity >= 0)
      OR (p_movement_type = 'prep_receive' AND p_quantity <= 0)
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500
     OR p_lot_number IS NULL OR length(p_lot_number) > 120 OR p_lot_number ~ '[[:cntrl:]]'
     OR p_source_reference IS NULL OR length(p_source_reference) > 200
     OR p_source_reference ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid inventory movement request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0));
  SELECT request_hash, response INTO v_hash, v_response
  FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_hash <> p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.opening_counts
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND status = 'applied') THEN
    RAISE EXCEPTION 'Review and apply an opening count before recording stock' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_product FROM v2.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
  VALUES (p_facility_id, p_warehouse_id, v_product.id) ON CONFLICT DO NOTHING;
  SELECT * INTO v_balance FROM v2.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id FOR UPDATE;
  SELECT COALESCE(sum(s.quantity), 0) INTO v_reserved
  FROM v2.run_inventory_staged_supplies s JOIN v2.runs r
    ON r.facility_id = s.facility_id AND r.id = s.run_id
  WHERE s.facility_id = p_facility_id AND s.warehouse_id = p_warehouse_id
    AND s.actual_product_id = v_product.id AND r.status <> 'completed';
  v_available := v_balance.quantity + p_quantity;
  IF v_available < v_reserved THEN
    RAISE EXCEPTION 'This change would remove stock reserved for a staged run supply' USING ERRCODE = '23514';
  END IF;
  IF v_available < 0 THEN RAISE EXCEPTION 'Insufficient stock for this adjustment' USING ERRCODE = '22003'; END IF;
  IF v_balance.revision = 9007199254740991 THEN RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003'; END IF;
  v_now := clock_timestamp();
  UPDATE v2.inventory_balances SET quantity = v_available, revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id;
  v_group_id := gen_random_uuid();
  INSERT INTO v2.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at, lot_number, source_reference
  ) VALUES (
    p_facility_id, p_warehouse_id, v_product.id, v_group_id, p_movement_type,
    p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now,
    p_lot_number, p_source_reference
  );
  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false, 'movementId', v_group_id,
    'warehouseId', p_warehouse_id, 'productCode', v_product.code,
    'quantity', v_available::text, 'revision', v_balance.revision + 1
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v2.record_inventory_movement_with_lot(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_warehouse_id uuid, p_product_code text, p_movement_type text,
  p_quantity numeric, p_reason text, p_lot_number text, p_source_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_movement_type NOT IN ('receipt','adjustment') THEN
    RAISE EXCEPTION 'Choose a receipt or stock adjustment' USING ERRCODE='22023';
  END IF;
  RETURN v2.record_inventory_movement_internal(
    p_facility_id,p_actor_id,p_command_id,p_request_hash,p_warehouse_id,p_product_code,
    p_movement_type,p_quantity,p_reason,p_lot_number,p_source_reference
  );
END
$$;

CREATE OR REPLACE FUNCTION v2.transfer_inventory(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_source_warehouse_id uuid, p_target_warehouse_id uuid, p_product_code text,
  p_quantity numeric, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_hash text; v_response jsonb; v_product v2.products%ROWTYPE;
  v_source numeric(20,6); v_target numeric(20,6);
  v_source_rev bigint; v_target_rev bigint; v_reserved numeric(20,6);
  v_now timestamptz; v_group uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_source_warehouse_id IS NULL OR p_target_warehouse_id IS NULL
     OR p_source_warehouse_id = p_target_warehouse_id OR p_quantity IS NULL
     OR p_quantity <= 0 OR p_quantity >= 100000000000000
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid inventory transfer request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0));
  SELECT request_hash, response INTO v_hash, v_response FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_hash <> p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND active
    AND id IN (p_source_warehouse_id, p_target_warehouse_id) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM v2.inventory_warehouses WHERE facility_id = p_facility_id
      AND active AND id IN (p_source_warehouse_id, p_target_warehouse_id)) <> 2 THEN
    RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM v2.opening_counts WHERE facility_id = p_facility_id
      AND status = 'applied' AND warehouse_id IN (p_source_warehouse_id, p_target_warehouse_id)) <> 2 THEN
    RAISE EXCEPTION 'Review and apply opening counts in both warehouses before transferring stock' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_product FROM v2.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
  VALUES (p_facility_id, p_source_warehouse_id, v_product.id),
    (p_facility_id, p_target_warehouse_id, v_product.id) ON CONFLICT DO NOTHING;
  SELECT quantity, revision INTO v_source, v_source_rev FROM v2.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_source_warehouse_id
    AND product_id = v_product.id FOR UPDATE;
  SELECT quantity, revision INTO v_target, v_target_rev FROM v2.inventory_balances
  WHERE facility_id = p_facility_id AND warehouse_id = p_target_warehouse_id
    AND product_id = v_product.id FOR UPDATE;
  SELECT COALESCE(sum(s.quantity), 0) INTO v_reserved
  FROM v2.run_inventory_staged_supplies s JOIN v2.runs r
    ON r.facility_id = s.facility_id AND r.id = s.run_id
  WHERE s.facility_id = p_facility_id AND s.warehouse_id = p_source_warehouse_id
    AND s.actual_product_id = v_product.id AND r.status <> 'completed';
  IF v_source - v_reserved < p_quantity THEN RAISE EXCEPTION 'Insufficient unreserved stock for this transfer' USING ERRCODE = '22003'; END IF;
  IF v_source_rev >= 9007199254740991 OR v_target_rev >= 9007199254740991 THEN
    RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003';
  END IF;
  v_now := clock_timestamp(); v_group := gen_random_uuid();
  UPDATE v2.inventory_balances SET quantity = quantity - p_quantity,
    revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_source_warehouse_id AND product_id = v_product.id;
  UPDATE v2.inventory_balances SET quantity = quantity + p_quantity,
    revision = revision + 1, updated_at = v_now
  WHERE facility_id = p_facility_id AND warehouse_id = p_target_warehouse_id AND product_id = v_product.id;
  INSERT INTO v2.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at
  ) VALUES (
    p_facility_id, p_source_warehouse_id, v_product.id, v_group, 'transfer_out',
    -p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now
  );
  INSERT INTO v2.inventory_movements (
    facility_id, warehouse_id, product_id, movement_group_id, movement_type,
    quantity_delta, reason, actor_id, command_id, occurred_at, source_reference
  ) VALUES (
    p_facility_id, p_target_warehouse_id, v_product.id, v_group, 'transfer_in',
    p_quantity, btrim(p_reason), p_actor_id, p_command_id, v_now, 'Transferred from another warehouse'
  );
  v_response := jsonb_build_object(
    'outcome', 'accepted', 'replayed', false, 'transferId', v_group,
    'productCode', v_product.code, 'quantity', p_quantity::text,
    'sourceWarehouseId', p_source_warehouse_id, 'sourceQuantity', (v_source-p_quantity)::text,
    'sourceRevision', v_source_rev+1, 'targetWarehouseId', p_target_warehouse_id,
    'targetQuantity', (v_target+p_quantity)::text, 'targetRevision', v_target_rev+1
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v2.list_inventory_preparation_setup(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'ingredients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', i.code, 'name', i.name, 'enabled', (i.data->>'enabled')::boolean,
        'productCode', p.code, 'productName', p.name, 'productUnit', p.base_unit,
        'stockUnitsPerLb', l.stock_units_per_lb::text
      ) ORDER BY lower(i.name), i.code)
      FROM v2.setup_ingredient_records i
      LEFT JOIN v2.setup_ingredient_inventory_links l
        ON l.facility_id = i.facility_id AND l.ingredient_code = i.code
      LEFT JOIN v2.products p ON p.facility_id = l.facility_id AND p.id = l.product_id AND p.active
      WHERE i.facility_id = p_facility_id AND COALESCE((i.data->>'enabled')::boolean, false)
    ), '[]'::jsonb),
    'mixes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', m.code, 'name', m.name, 'enabled', (m.data->>'enabled')::boolean,
        'isPrep', (m.data->>'isPrep')::boolean, 'batchSizeLbs', m.data->'batchSizeLbs',
        'productCode', outp.code, 'productName', outp.name, 'productUnit', outp.base_unit,
        'stockUnitsPerLb', ml.stock_units_per_lb::text,
        'components', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'ingredientCode', COALESCE(link.ingredient_code, component.value->>'ingredientCode'),
            'ingredientName', component.value->>'ingredientName',
            'perBatchLbs', component.value->>'perBatchLbs',
            'productCode', rawp.code, 'productName', rawp.name, 'productUnit', rawp.base_unit,
            'stockUnitsPerLb', il.stock_units_per_lb::text
          ) ORDER BY component.ordinality)
          FROM jsonb_array_elements(m.data->'components') WITH ORDINALITY AS component(value, ordinality)
          LEFT JOIN v2.setup_mix_component_links link
            ON link.facility_id = m.facility_id AND lower(link.mix_code) = lower(m.code)
              AND link.component_index = component.ordinality - 1
          LEFT JOIN v2.setup_ingredient_inventory_links il
            ON il.facility_id = m.facility_id AND lower(il.ingredient_code) = lower(link.ingredient_code)
          LEFT JOIN v2.products rawp ON rawp.facility_id = il.facility_id AND rawp.id = il.product_id AND rawp.active
        ), '[]'::jsonb)
      ) ORDER BY lower(m.name), m.code)
      FROM v2.setup_mix_records m
      LEFT JOIN v2.setup_mix_inventory_links ml
        ON ml.facility_id = m.facility_id AND ml.mix_code = m.code
      LEFT JOIN v2.products outp ON outp.facility_id = ml.facility_id AND outp.id = ml.product_id AND outp.active
      WHERE m.facility_id = p_facility_id AND COALESCE((m.data->>'enabled')::boolean, false)
    ), '[]'::jsonb)
  );
END
$$;

CREATE FUNCTION v2.list_run_inventory_products(p_facility_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid facility scope' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'code', code, 'name', name, 'unit', base_unit
    ) ORDER BY lower(name), id)
    FROM v2.products
    WHERE facility_id = p_facility_id AND active
  ), '[]'::jsonb);
END
$$;

CREATE FUNCTION v2.set_setup_inventory_link(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_kind text, p_source_code text, p_product_code text, p_stock_units_per_lb numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_hash text; v_response jsonb; v_product v2.products%ROWTYPE; v_now timestamptz;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_kind NOT IN ('ingredient', 'mix')
     OR p_source_code IS NULL OR p_source_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_product_code IS NULL OR p_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_stock_units_per_lb IS NULL OR p_stock_units_per_lb <= 0 OR p_stock_units_per_lb >= 1000000 THEN
    RAISE EXCEPTION 'Invalid setup inventory link' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0));
  SELECT request_hash, response INTO v_hash, v_response FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_hash <> p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  SELECT * INTO v_product FROM v2.products
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_product_code) AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  IF p_kind = 'ingredient' THEN
    IF NOT EXISTS (SELECT 1 FROM v2.setup_ingredient_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(p_source_code)
        AND COALESCE((data->>'enabled')::boolean, false)) THEN
      RAISE EXCEPTION 'Enabled ingredient identity not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO v2.setup_ingredient_inventory_links (
      facility_id, ingredient_code, product_id, stock_units_per_lb, actor_id, updated_at
    ) SELECT p_facility_id, code, v_product.id, p_stock_units_per_lb, p_actor_id, clock_timestamp()
      FROM v2.setup_ingredient_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(p_source_code)
    ON CONFLICT (facility_id, ingredient_code) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      stock_units_per_lb = EXCLUDED.stock_units_per_lb,
      actor_id = EXCLUDED.actor_id,
      updated_at = EXCLUDED.updated_at;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM v2.setup_mix_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(p_source_code)
        AND COALESCE((data->>'enabled')::boolean, false)
        AND COALESCE((data->>'isPrep')::boolean, false)
        AND (data->>'batchSizeLbs') ~ '^[0-9]+([.][0-9]+)?$'
        AND (data->>'batchSizeLbs')::numeric > 0) THEN
      RAISE EXCEPTION 'Enabled prep mix with a positive batch size not found' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO v2.setup_mix_inventory_links (
      facility_id, mix_code, product_id, stock_units_per_lb, actor_id, updated_at
    ) SELECT p_facility_id, code, v_product.id, p_stock_units_per_lb, p_actor_id, clock_timestamp()
      FROM v2.setup_mix_records
      WHERE facility_id = p_facility_id AND lower(code) = lower(p_source_code)
    ON CONFLICT (facility_id, mix_code) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      stock_units_per_lb = EXCLUDED.stock_units_per_lb,
      actor_id = EXCLUDED.actor_id,
      updated_at = EXCLUDED.updated_at;
  END IF;
  v_now := clock_timestamp();
  v_response := jsonb_build_object(
    'outcome', 'linked', 'replayed', false, 'kind', p_kind,
    'sourceCode', p_source_code, 'productCode', v_product.code,
    'stockUnitsPerLb', p_stock_units_per_lb::text, 'updatedAt', v_now
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v2.prepare_inventory_mix(
  p_facility_id uuid, p_actor_id uuid, p_command_id text, p_request_hash text,
  p_mix_code text, p_source_warehouse_id uuid, p_output_warehouse_id uuid,
  p_batch_count numeric, p_lot_number text, p_source_reference text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_hash text; v_response jsonb; v_mix v2.setup_mix_records%ROWTYPE;
  v_component record; v_output v2.products%ROWTYPE; v_now timestamptz;
  v_prep_id uuid; v_batch_lbs numeric; v_output_qty numeric;
  v_detail jsonb := '[]'::jsonb; v_part jsonb; v_child_id text; v_child_hash text;
  v_index integer := 0;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_mix_code IS NULL OR p_mix_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_source_warehouse_id IS NULL OR p_output_warehouse_id IS NULL
     OR p_batch_count IS NULL OR p_batch_count <= 0 OR p_batch_count > 1000000
     OR p_lot_number IS NULL OR length(p_lot_number) > 120 OR p_lot_number ~ '[[:cntrl:]]'
     OR p_source_reference IS NULL OR length(p_source_reference) > 200 OR p_source_reference ~ '[[:cntrl:]]'
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid preparation request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_command_id, 0));
  SELECT request_hash, response INTO v_hash, v_response FROM v2.command_receipts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND command_id = p_command_id;
  IF FOUND THEN
    IF v_hash <> p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE = '22023'; END IF;
    RETURN v_response || jsonb_build_object('replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
    WHERE facility_id = p_facility_id AND active
      AND id IN (p_source_warehouse_id, p_output_warehouse_id) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM v2.inventory_warehouses WHERE facility_id = p_facility_id AND active
      AND id IN (p_source_warehouse_id, p_output_warehouse_id)) <> 2
     AND p_source_warehouse_id <> p_output_warehouse_id THEN
    RAISE EXCEPTION 'Preparation warehouse not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.opening_counts WHERE facility_id = p_facility_id
      AND warehouse_id = p_source_warehouse_id AND status = 'applied')
     OR NOT EXISTS (SELECT 1 FROM v2.opening_counts WHERE facility_id = p_facility_id
      AND warehouse_id = p_output_warehouse_id AND status = 'applied') THEN
    RAISE EXCEPTION 'Apply physical opening counts before preparation' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_mix FROM v2.setup_mix_records
  WHERE facility_id = p_facility_id AND lower(code) = lower(p_mix_code)
    AND COALESCE((data->>'enabled')::boolean, false)
    AND COALESCE((data->>'isPrep')::boolean, false)
  FOR SHARE;
  IF NOT FOUND OR (v_mix.data->>'batchSizeLbs') !~ '^[0-9]+([.][0-9]+)?$'
     OR (v_mix.data->>'batchSizeLbs')::numeric <= 0 THEN
    RAISE EXCEPTION 'The selected linked prep mix is not available' USING ERRCODE = '55000';
  END IF;
  SELECT p.* INTO v_output
  FROM v2.setup_mix_inventory_links l
  JOIN v2.products p ON p.facility_id = l.facility_id AND p.id = l.product_id AND p.active
  WHERE l.facility_id = p_facility_id AND lower(l.mix_code) = lower(v_mix.code)
  FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'The prep mix has no active prepared-stock product link' USING ERRCODE = '55000'; END IF;
  IF p_source_warehouse_id <> p_output_warehouse_id THEN
    PERFORM 1 FROM v2.inventory_warehouses
      WHERE facility_id = p_facility_id AND id IN (p_source_warehouse_id, p_output_warehouse_id)
      ORDER BY id FOR UPDATE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_mix.data->'components') WITH ORDINALITY AS c(value, ordinality)
    WHERE c.value->>'perBatchLbs' IS NULL
       OR c.value->>'perBatchLbs' !~ '^[0-9]+([.][0-9]+)?$'
       OR (c.value->>'perBatchLbs')::numeric <= 0
       OR c.value->>'ingredientCode' IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM v2.setup_mix_component_links ml
         JOIN v2.setup_ingredient_inventory_links il
           ON il.facility_id = ml.facility_id AND lower(il.ingredient_code) = lower(ml.ingredient_code)
         JOIN v2.products p ON p.facility_id = il.facility_id AND p.id = il.product_id AND p.active
         WHERE ml.facility_id = p_facility_id AND lower(ml.mix_code) = lower(v_mix.code)
           AND ml.component_index = (c.ordinality - 1)
       )
  ) THEN
    RAISE EXCEPTION 'The prep mix has unresolved ingredients or missing per-batch pound mappings' USING ERRCODE = '55000';
  END IF;
  v_prep_id := gen_random_uuid();
  FOR v_component IN
    SELECT ml.ingredient_code, p.id AS product_id, p.code AS product_code,
      p.name AS product_name, p.base_unit, il.stock_units_per_lb,
      (c.value->>'perBatchLbs')::numeric * p_batch_count * il.stock_units_per_lb AS quantity
    FROM jsonb_array_elements(v_mix.data->'components') WITH ORDINALITY AS c(value, ordinality)
    JOIN v2.setup_mix_component_links ml
      ON ml.facility_id = p_facility_id AND lower(ml.mix_code) = lower(v_mix.code)
        AND ml.component_index = c.ordinality - 1
    JOIN v2.setup_ingredient_inventory_links il
      ON il.facility_id = ml.facility_id AND lower(il.ingredient_code) = lower(ml.ingredient_code)
    JOIN v2.products p ON p.facility_id = il.facility_id AND p.id = il.product_id AND p.active
    ORDER BY p.id
  LOOP
    IF v_component.quantity <> round(v_component.quantity, 6) THEN
      RAISE EXCEPTION 'The linked ingredient formula exceeds inventory unit precision' USING ERRCODE = '22023';
    END IF;
    v_index := v_index + 1;
    v_child_id := 'prep:' || v_prep_id::text || ':component:' || v_index::text;
    v_child_hash := repeat(md5(p_request_hash || ':' || v_index::text), 2);
    PERFORM v2.record_inventory_movement_internal(
      p_facility_id, p_actor_id, v_child_id, v_child_hash,
      p_source_warehouse_id, v_component.product_code, 'prep_consume',
       -round(v_component.quantity, 6), btrim(p_reason), '', 'Prep mix ' || v_mix.code
    );
    v_part := jsonb_build_object(
      'ingredientCode', v_component.ingredient_code,
      'productId', v_component.product_id,
      'productCode', v_component.product_code,
      'productName', v_component.product_name,
      'unit', v_component.base_unit,
      'quantity', round(v_component.quantity, 6)::text
    );
    v_detail := v_detail || jsonb_build_array(v_part);
  END LOOP;
  SELECT l.stock_units_per_lb * (v_mix.data->>'batchSizeLbs')::numeric * p_batch_count
  INTO v_output_qty FROM v2.setup_mix_inventory_links l
  WHERE l.facility_id = p_facility_id AND lower(l.mix_code) = lower(v_mix.code);
  IF v_output_qty IS NULL OR v_output_qty <= 0 THEN
    RAISE EXCEPTION 'The prepared-stock output mapping is unavailable' USING ERRCODE = '55000';
  END IF;
  IF v_output_qty <> round(v_output_qty, 6) THEN
    RAISE EXCEPTION 'The prepared-stock formula exceeds inventory unit precision' USING ERRCODE = '22023';
  END IF;
  v_output_qty := round(v_output_qty, 6);
  v_child_id := 'prep:' || v_prep_id::text || ':prepared-output';
  v_child_hash := repeat(md5(p_request_hash || ':prepared-output'), 2);
  PERFORM v2.record_inventory_movement_internal(
    p_facility_id, p_actor_id, v_child_id, v_child_hash,
    p_output_warehouse_id, v_output.code, 'prep_receive', v_output_qty,
    btrim(p_reason), p_lot_number, COALESCE(NULLIF(p_source_reference, ''), 'Prep mix ' || v_mix.code)
  );
  v_now := clock_timestamp();
  v_response := jsonb_build_object(
    'outcome', 'prepared', 'replayed', false, 'preparationId', v_prep_id,
    'mixCode', v_mix.code, 'mixName', v_mix.name,
    'batchCount', p_batch_count::text, 'sourceWarehouseId', p_source_warehouse_id,
    'outputWarehouseId', p_output_warehouse_id, 'preparedProductCode', v_output.code,
    'preparedQuantity', v_output_qty::text, 'preparedUnit', v_output.base_unit,
    'components', v_detail, 'occurredAt', v_now
  );
  INSERT INTO v2.inventory_preparations (
    facility_id, id, mix_code, source_warehouse_id, output_warehouse_id, actor_id,
    command_id, request_hash, batch_count, prepared_product_id, prepared_quantity,
    lot_number, source_reference, reason, occurred_at, detail
  ) VALUES (
    p_facility_id, v_prep_id, v_mix.code, p_source_warehouse_id, p_output_warehouse_id,
    p_actor_id, p_command_id, p_request_hash, p_batch_count, v_output.id, v_output_qty,
    p_lot_number, p_source_reference, btrim(p_reason), v_now, v_response
  );
  INSERT INTO v2.command_receipts (facility_id, actor_id, command_id, request_hash, response, created_at)
  VALUES (p_facility_id, p_actor_id, p_command_id, p_request_hash, v_response, v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v2.list_inventory_preparations(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid preparation history request' USING ERRCODE='22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',p.id,'mixCode',p.mix_code,'mixName',m.name,
      'sourceWarehouseId',p.source_warehouse_id,'sourceWarehouseName',sw.name,
      'outputWarehouseId',p.output_warehouse_id,'outputWarehouseName',ow.name,
      'batchCount',p.batch_count::text,'preparedProductCode',product.code,
      'preparedProductName',product.name,'preparedUnit',product.base_unit,
      'preparedQuantity',p.prepared_quantity::text,'lotNumber',p.lot_number,
      'sourceReference',p.source_reference,'reason',p.reason,'actorId',p.actor_id,
      'occurredAt',p.occurred_at,'components',p.detail->'components'
    ) ORDER BY p.occurred_at DESC,p.id DESC)
    FROM (SELECT * FROM v2.inventory_preparations WHERE facility_id=p_facility_id
      ORDER BY occurred_at DESC,id DESC LIMIT p_limit) p
    JOIN v2.setup_mix_records m ON m.facility_id=p.facility_id AND m.code=p.mix_code
    JOIN v2.inventory_warehouses sw ON sw.facility_id=p.facility_id AND sw.id=p.source_warehouse_id
    JOIN v2.inventory_warehouses ow ON ow.facility_id=p.facility_id AND ow.id=p.output_warehouse_id
    JOIN v2.products product ON product.facility_id=p.facility_id AND product.id=p.prepared_product_id
  ),'[]'::jsonb);
END
$$;

CREATE FUNCTION v2.stage_inventory_cycle_count(
  p_facility_id uuid, p_actor_id uuid, p_request_id text, p_request_hash text,
  p_warehouse_id uuid, p_rows jsonb, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_existing v2.inventory_cycle_counts%ROWTYPE;
  v_row jsonb; v_enriched jsonb := '[]'::jsonb; v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE; v_id uuid;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_warehouse_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id)
     OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid cycle count request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text || ':' || p_actor_id::text || ':' || p_request_id, 0));
  SELECT * INTO v_existing FROM v2.inventory_cycle_counts
  WHERE facility_id = p_facility_id AND actor_id = p_actor_id AND request_id = p_request_id FOR UPDATE;
  IF FOUND THEN
     IF v_existing.request_hash <> p_request_hash OR v_existing.warehouse_id <> p_warehouse_id THEN
      RAISE EXCEPTION 'Cycle-count request ID was reused with different details' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('outcome', v_existing.status, 'countId', v_existing.id,
      'warehouseId', v_existing.warehouse_id, 'rowCount', jsonb_array_length(v_existing.rows), 'replayed', true);
  END IF;
  PERFORM 1 FROM v2.inventory_warehouses
  WHERE facility_id = p_facility_id AND id = p_warehouse_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM v2.opening_counts WHERE facility_id = p_facility_id
      AND warehouse_id = p_warehouse_id AND status = 'applied') THEN
    RAISE EXCEPTION 'Apply the opening count before cycle counting' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM v2.inventory_cycle_counts WHERE facility_id = p_facility_id
      AND warehouse_id = p_warehouse_id AND status IN ('staged', 'reviewed')) THEN
    RAISE EXCEPTION 'A cycle count is already waiting for review or application' USING ERRCODE = '55000';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object'
       OR (v_row - ARRAY['productCode','quantity']) <> '{}'::jsonb
       OR jsonb_typeof(v_row->'productCode') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_row->'quantity') IS DISTINCT FROM 'string'
       OR (v_row->>'quantity') !~ '^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$' THEN
      RAISE EXCEPTION 'Cycle count has an invalid row' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_product FROM v2.products
    WHERE facility_id = p_facility_id AND active AND lower(code) = lower(v_row->>'productCode') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cycle count references an unknown product' USING ERRCODE = '22023'; END IF;
    INSERT INTO v2.inventory_balances (facility_id, warehouse_id, product_id)
      VALUES (p_facility_id, p_warehouse_id, v_product.id) ON CONFLICT DO NOTHING;
    SELECT * INTO v_balance FROM v2.inventory_balances
    WHERE facility_id = p_facility_id AND warehouse_id = p_warehouse_id AND product_id = v_product.id FOR UPDATE;
    v_enriched := v_enriched || jsonb_build_array(jsonb_build_object(
      'productCode', v_product.code, 'quantity', v_row->>'quantity',
      'baselineQuantity', v_balance.quantity::text, 'baselineRevision', v_balance.revision
    ));
  END LOOP;
  IF (SELECT count(DISTINCT lower(value->>'productCode')) FROM jsonb_array_elements(p_rows)) <>
     jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'Cycle count contains duplicate product codes' USING ERRCODE = '22023';
  END IF;
  INSERT INTO v2.inventory_cycle_counts (
    facility_id, warehouse_id, actor_id, request_id, request_hash, rows, reason
  ) VALUES (p_facility_id, p_warehouse_id, p_actor_id, p_request_id, p_request_hash, v_enriched, btrim(p_reason))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('outcome','staged','countId',v_id,'warehouseId',p_warehouse_id,
    'rowCount',jsonb_array_length(v_enriched),'replayed',false,'rows',v_enriched);
END
$$;

CREATE FUNCTION v2.get_inventory_cycle_count(p_facility_id uuid, p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_count v2.inventory_cycle_counts%ROWTYPE;
BEGIN
  IF p_facility_id IS NULL OR p_count_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid cycle count scope' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_count FROM v2.inventory_cycle_counts
  WHERE facility_id = p_facility_id AND id = p_count_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',v_count.id,'warehouseId',v_count.warehouse_id,
    'status',v_count.status,'rows',v_count.rows,'reason',v_count.reason,
    'createdBy',v_count.actor_id,'createdAt',v_count.created_at,
    'reviewedBy',v_count.reviewed_by,'reviewedAt',v_count.reviewed_at,
    'appliedBy',v_count.applied_by,'appliedAt',v_count.applied_at,'result',v_count.result);
END
$$;

CREATE FUNCTION v2.review_inventory_cycle_count(p_facility_id uuid, p_actor_id uuid, p_count_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_count v2.inventory_cycle_counts%ROWTYPE; v_row jsonb; v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE; v_review_rows jsonb := '[]'::jsonb; v_delta numeric;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_count_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid cycle count scope' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_count FROM v2.inventory_cycle_counts WHERE facility_id = p_facility_id AND id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle count not found' USING ERRCODE = 'P0002'; END IF;
  IF v_count.status = 'applied' THEN RETURN COALESCE(v_count.result,'{}'::jsonb) || jsonb_build_object('replayed',true); END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_count.rows) LOOP
    SELECT * INTO v_product FROM v2.products WHERE facility_id = p_facility_id
      AND lower(code) = lower(v_row->>'productCode') AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A counted product is no longer active; stage a fresh count' USING ERRCODE = '40001'; END IF;
    SELECT * INTO v_balance FROM v2.inventory_balances WHERE facility_id = p_facility_id
      AND warehouse_id = v_count.warehouse_id AND product_id = v_product.id FOR UPDATE;
    IF v_balance.revision <> (v_row->>'baselineRevision')::bigint
       OR v_balance.quantity <> (v_row->>'baselineQuantity')::numeric THEN
      UPDATE v2.inventory_cycle_counts SET status='stale',
        result=jsonb_build_object('outcome','stale','countId',p_count_id,
          'warehouseId',v_count.warehouse_id,'reason','Stock changed after the count was staged',
          'detectedAt',clock_timestamp())
      WHERE facility_id=p_facility_id AND id=p_count_id;
      RETURN jsonb_build_object('outcome','stale','countId',p_count_id,
        'warehouseId',v_count.warehouse_id,'rows',v_count.rows,'replayed',false);
    END IF;
    v_delta := (v_row->>'quantity')::numeric - v_balance.quantity;
    v_review_rows := v_review_rows || jsonb_build_array(v_row || jsonb_build_object(
      'currentQuantity',v_balance.quantity::text,'variance',v_delta::text,'unit',v_product.base_unit));
  END LOOP;
  IF v_count.status = 'staged' THEN
    UPDATE v2.inventory_cycle_counts SET status='reviewed', reviewed_by=p_actor_id, reviewed_at=clock_timestamp(),
      rows=v_review_rows WHERE facility_id=p_facility_id AND id=p_count_id RETURNING * INTO v_count;
  END IF;
  RETURN jsonb_build_object('outcome',v_count.status,'countId',v_count.id,
    'warehouseId',v_count.warehouse_id,'rows',v_review_rows,'reviewedAt',v_count.reviewed_at,
    'replayed',v_count.status <> 'reviewed' OR v_count.reviewed_by <> p_actor_id);
END
$$;

CREATE FUNCTION v2.apply_inventory_cycle_count(p_facility_id uuid, p_actor_id uuid, p_count_id uuid, p_acknowledged boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_count v2.inventory_cycle_counts%ROWTYPE; v_row jsonb; v_product v2.products%ROWTYPE;
  v_balance v2.inventory_balances%ROWTYPE; v_now timestamptz; v_delta numeric;
  v_group uuid; v_result jsonb; v_rows jsonb := '[]'::jsonb; v_reserved numeric;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_count_id IS NULL OR p_acknowledged IS DISTINCT FROM true
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id = p_facility_id) THEN
    RAISE EXCEPTION 'Explicit cycle count acknowledgement is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_count FROM v2.inventory_cycle_counts WHERE facility_id=p_facility_id AND id=p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle count not found' USING ERRCODE = 'P0002'; END IF;
  IF v_count.status='applied' THEN RETURN COALESCE(v_count.result,'{}'::jsonb) || jsonb_build_object('replayed',true); END IF;
  IF v_count.status='stale' THEN RETURN COALESCE(v_count.result,'{}'::jsonb) || jsonb_build_object('replayed',true); END IF;
  IF v_count.status <> 'reviewed' THEN RAISE EXCEPTION 'Review the cycle count before applying it' USING ERRCODE = '55000'; END IF;
  PERFORM 1 FROM v2.inventory_warehouses WHERE facility_id=p_facility_id AND id=v_count.warehouse_id AND active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = 'P0002'; END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_count.rows) LOOP
    SELECT * INTO v_product FROM v2.products WHERE facility_id=p_facility_id AND active
      AND lower(code)=lower(v_row->>'productCode') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A counted product is no longer active; stage a fresh count' USING ERRCODE = '40001'; END IF;
    SELECT * INTO v_balance FROM v2.inventory_balances WHERE facility_id=p_facility_id
      AND warehouse_id=v_count.warehouse_id AND product_id=v_product.id FOR UPDATE;
    IF v_balance.revision <> (v_row->>'baselineRevision')::bigint
       OR v_balance.quantity <> (v_row->>'baselineQuantity')::numeric THEN
      UPDATE v2.inventory_cycle_counts SET status='stale',
        result=jsonb_build_object('outcome','stale','countId',p_count_id,
          'warehouseId',v_count.warehouse_id,'reason','Stock changed after the count was reviewed',
          'detectedAt',clock_timestamp())
      WHERE facility_id=p_facility_id AND id=p_count_id;
      RETURN jsonb_build_object('outcome','stale','countId',p_count_id,
        'warehouseId',v_count.warehouse_id,'rows',v_count.rows,'replayed',false);
    END IF;
    SELECT COALESCE(sum(s.quantity),0) INTO v_reserved FROM v2.run_inventory_staged_supplies s
      JOIN v2.runs r ON r.facility_id=s.facility_id AND r.id=s.run_id
      WHERE s.facility_id=p_facility_id AND s.warehouse_id=v_count.warehouse_id
        AND s.actual_product_id=v_product.id AND r.status <> 'completed';
    IF (v_row->>'quantity')::numeric < v_reserved THEN
      RAISE EXCEPTION 'The count is below stock reserved for an active staged run' USING ERRCODE = '23514';
    END IF;
    v_delta := (v_row->>'quantity')::numeric - v_balance.quantity;
    IF v_delta <> 0 THEN
      IF v_balance.revision >= 9007199254740991 THEN RAISE EXCEPTION 'Inventory revision exhausted' USING ERRCODE = '22003'; END IF;
      UPDATE v2.inventory_balances SET quantity=(v_row->>'quantity')::numeric,
        revision=revision+1, updated_at=clock_timestamp()
      WHERE facility_id=p_facility_id AND warehouse_id=v_count.warehouse_id AND product_id=v_product.id;
      v_group := gen_random_uuid(); v_now := clock_timestamp();
      INSERT INTO v2.inventory_movements (
        facility_id,warehouse_id,product_id,movement_group_id,movement_type,quantity_delta,
        reason,actor_id,command_id,occurred_at,source_reference
      ) VALUES (p_facility_id,v_count.warehouse_id,v_product.id,v_group,'cycle_count',v_delta,
        v_count.reason,p_actor_id,'cycle:'||p_count_id::text||':'||v_product.id::text,v_now,
        'Reviewed cycle count '||p_count_id::text);
    END IF;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'productCode',v_product.code,'counted',v_row->>'quantity',
      'baseline',v_balance.quantity::text,'variance',v_delta::text,'unit',v_product.base_unit));
  END LOOP;
  v_now := clock_timestamp();
  v_result := jsonb_build_object('outcome','applied','countId',p_count_id,
    'warehouseId',v_count.warehouse_id,'rowCount',jsonb_array_length(v_count.rows),
    'rows',v_rows,'appliedAt',v_now,'replayed',false);
  UPDATE v2.inventory_cycle_counts SET status='applied',applied_by=p_actor_id,
    applied_at=v_now,result=v_result WHERE facility_id=p_facility_id AND id=p_count_id;
  RETURN v_result;
END
$$;

CREATE FUNCTION v2.list_inventory_cycle_counts(p_facility_id uuid, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid cycle count list request' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',c.id,'warehouseId',c.warehouse_id,
      'warehouseName',w.name,'status',c.status,'rowCount',jsonb_array_length(c.rows),
      'createdBy',c.actor_id,'createdAt',c.created_at,'reviewedBy',c.reviewed_by,
      'reviewedAt',c.reviewed_at,'appliedBy',c.applied_by,'appliedAt',c.applied_at)
      ORDER BY c.created_at DESC,c.id DESC)
    FROM (SELECT * FROM v2.inventory_cycle_counts WHERE facility_id=p_facility_id
      ORDER BY created_at DESC,id DESC LIMIT p_limit) c
    JOIN v2.inventory_warehouses w ON w.facility_id=c.facility_id AND w.id=c.warehouse_id
  ),'[]'::jsonb);
END
$$;

CREATE FUNCTION v2.stage_run_inventory_supply(
  p_facility_id uuid,p_actor_id uuid,p_command_id text,p_request_hash text,
  p_run_id uuid,p_planned_product_code text,p_actual_product_code text,
  p_quantity numeric,p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE v_hash text; v_response jsonb; v_run v2.runs%ROWTYPE;
  v_expected v2.products%ROWTYPE; v_actual v2.products%ROWTYPE; v_warehouse uuid;
  v_balance numeric; v_reserved numeric; v_id uuid; v_now timestamptz;
BEGIN
  IF p_facility_id IS NULL OR p_actor_id IS NULL OR p_run_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id)
     OR p_command_id IS NULL OR length(btrim(p_command_id)) NOT BETWEEN 1 AND 200
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_planned_product_code IS NULL OR p_planned_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_actual_product_code IS NULL OR p_actual_product_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
     OR p_quantity IS NULL OR p_quantity <= 0 OR p_quantity >= 100000000000000
     OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid staged supply request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text||':'||p_actor_id::text||':'||p_command_id,0));
  SELECT request_hash,response INTO v_hash,v_response FROM v2.command_receipts
    WHERE facility_id=p_facility_id AND actor_id=p_actor_id AND command_id=p_command_id;
  IF FOUND THEN
    IF v_hash<>p_request_hash THEN RAISE EXCEPTION 'Command ID was reused with different details' USING ERRCODE='22023'; END IF;
    RETURN v_response||jsonb_build_object('replayed',true);
  END IF;
  SELECT * INTO v_run FROM v2.runs WHERE facility_id=p_facility_id AND id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.status='completed' THEN RAISE EXCEPTION 'Run is unavailable for staging' USING ERRCODE='55000'; END IF;
  BEGIN v_warehouse := (v_run.setup_snapshot->'productionPlan'->'warehouse'->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Run inventory plan is invalid' USING ERRCODE='22023'; END;
  SELECT * INTO v_expected FROM v2.products
    WHERE facility_id=p_facility_id AND active AND lower(code)=lower(p_planned_product_code) FOR SHARE;
  SELECT * INTO v_actual FROM v2.products
    WHERE facility_id=p_facility_id AND active AND lower(code)=lower(p_actual_product_code) FOR SHARE;
  IF v_expected.id IS NULL THEN RAISE EXCEPTION 'Planned product is not active' USING ERRCODE='P0002'; END IF;
  IF v_actual.id IS NULL THEN RAISE EXCEPTION 'Replacement product is not active' USING ERRCODE='P0002'; END IF;
  IF lower(v_expected.base_unit) <> lower(v_actual.base_unit) THEN
    RAISE EXCEPTION 'Planned and replacement products must use the same stock unit' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_run.setup_snapshot->'productionPlan'->'recipes') r(value)
      CROSS JOIN LATERAL jsonb_array_elements(r.value->'ingredients') l(value)
    WHERE (l.value->>'productId')::uuid=v_expected.id
    UNION ALL
    SELECT 1 FROM jsonb_array_elements(v_run.setup_snapshot->'productionPlan'->'packagingPerCase') l(value)
    WHERE (l.value->>'productId')::uuid=v_expected.id
  ) THEN RAISE EXCEPTION 'The selected planned product is not part of this run' USING ERRCODE='22023'; END IF;
  INSERT INTO v2.inventory_balances(facility_id,warehouse_id,product_id)
    VALUES(p_facility_id,v_warehouse,v_actual.id) ON CONFLICT DO NOTHING;
  SELECT quantity INTO v_balance FROM v2.inventory_balances
    WHERE facility_id=p_facility_id AND warehouse_id=v_warehouse AND product_id=v_actual.id FOR UPDATE;
  SELECT COALESCE(sum(s.quantity),0) INTO v_reserved FROM v2.run_inventory_staged_supplies s
    JOIN v2.runs r ON r.facility_id=s.facility_id AND r.id=s.run_id
    WHERE s.facility_id=p_facility_id AND s.warehouse_id=v_warehouse
      AND s.actual_product_id=v_actual.id AND r.status<>'completed';
  IF v_balance-v_reserved < p_quantity THEN
    RAISE EXCEPTION 'The selected supply exceeds available unreserved stock' USING ERRCODE='22003';
  END IF;
  v_now:=clock_timestamp();v_id:=gen_random_uuid();
  INSERT INTO v2.run_inventory_staged_supplies(
    facility_id,id,run_id,warehouse_id,planned_product_id,actual_product_id,
    quantity,reason,actor_id,command_id,request_hash,occurred_at
  ) VALUES (p_facility_id,v_id,p_run_id,v_warehouse,v_expected.id,v_actual.id,
    p_quantity,btrim(p_reason),p_actor_id,p_command_id,p_request_hash,v_now);
  v_response:=jsonb_build_object('outcome','staged','replayed',false,'stageId',v_id,
    'runId',p_run_id,'warehouseId',v_warehouse,'plannedProductCode',v_expected.code,
    'actualProductCode',v_actual.code,'quantity',p_quantity::text,'reason',btrim(p_reason),'occurredAt',v_now);
  INSERT INTO v2.command_receipts(facility_id,actor_id,command_id,request_hash,response,created_at)
    VALUES(p_facility_id,p_actor_id,p_command_id,p_request_hash,v_response,v_now);
  RETURN v_response;
END
$$;

CREATE FUNCTION v2.list_run_inventory_staged_supplies(p_facility_id uuid,p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id
  ) THEN RAISE EXCEPTION 'Invalid staged supply scope' USING ERRCODE='42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',s.id,'runId',s.run_id,'warehouseId',s.warehouse_id,
      'plannedProductId',s.planned_product_id,'plannedProductCode',wanted.code,
      'plannedProductName',wanted.name,'actualProductId',s.actual_product_id,
      'actualProductCode',actual.code,'actualProductName',actual.name,'unit',actual.base_unit,
      'quantity',s.quantity::text,'reason',s.reason,'actorId',s.actor_id,'occurredAt',s.occurred_at,
      'used',COALESCE(r.quantity_used,0)::text,'released',COALESCE(r.quantity_released,0)::text
    ) ORDER BY s.occurred_at,s.id)
    FROM v2.run_inventory_staged_supplies s
    JOIN v2.products wanted ON wanted.facility_id=s.facility_id AND wanted.id=s.planned_product_id
    JOIN v2.products actual ON actual.facility_id=s.facility_id AND actual.id=s.actual_product_id
    LEFT JOIN v2.run_inventory_stage_receipts r ON r.facility_id=s.facility_id AND r.staged_supply_id=s.id
    WHERE s.facility_id=p_facility_id AND s.run_id=p_run_id
  ),'[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION v2.apply_run_inventory_consumption(
  p_facility_id uuid, p_run_id uuid, p_actor_id uuid, p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, v2
AS $$
DECLARE
  v_warehouse_id uuid; v_warehouse_name text; v_demand record; v_balance v2.inventory_balances%ROWTYPE;
  v_stage record; v_required numeric; v_staged_used numeric; v_remaining numeric; v_deducted numeric;
  v_available numeric; v_reserved numeric; v_lines jsonb:='[]'::jsonb; v_detail jsonb;
  v_now timestamptz:=clock_timestamp(); v_actual v2.products%ROWTYPE; v_movement uuid;
  v_line jsonb; v_uses jsonb:='[]'::jsonb; v_stage_quantity numeric;
BEGIN
  IF p_facility_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL
     OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR NOT EXISTS(SELECT 1 FROM v2.facility_scope WHERE singleton AND facility_id=p_facility_id) THEN
    RAISE EXCEPTION 'Invalid run inventory scope' USING ERRCODE='42501';
  END IF;
  BEGIN v_warehouse_id:=(p_plan->'warehouse'->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid run inventory warehouse' USING ERRCODE='22023'; END;
  SELECT w.name INTO v_warehouse_name FROM v2.inventory_warehouses w
    WHERE w.facility_id=p_facility_id AND w.id=v_warehouse_id AND w.active
      AND EXISTS(SELECT 1 FROM v2.opening_counts c WHERE c.facility_id=w.facility_id
        AND c.warehouse_id=w.id AND c.status='applied') FOR UPDATE;
  IF v_warehouse_name IS NULL THEN RAISE EXCEPTION 'The run production warehouse is unavailable' USING ERRCODE='55000'; END IF;
  -- Current recorded station progress, never browser state, defines demand.
  FOR v_demand IN
    WITH station_counts AS (
      SELECT station_key, CASE WHEN station_key='sauce' AND progress->>'barrelsMade' ~ '^[0-9]+$'
        THEN (progress->>'barrelsMade')::numeric
        WHEN progress->>'batchesMade' ~ '^[0-9]+$' THEN (progress->>'batchesMade')::numeric
        ELSE 0::numeric END AS quantity
      FROM v2.run_station_progress WHERE facility_id=p_facility_id AND run_id=p_run_id
    ), recipe_demand AS (
      SELECT (i.value->>'productId')::uuid product_id,i.value->>'productCode' product_code,
        i.value->>'productName' product_name,i.value->>'unit' unit,
        sum((i.value->>'quantity')::numeric*s.quantity) required
      FROM jsonb_array_elements(p_plan->'recipes') r(value)
      JOIN station_counts s ON s.station_key=r.value->>'stationKey'
      CROSS JOIN LATERAL jsonb_array_elements(r.value->'ingredients') i(value)
      GROUP BY i.value->>'productId',i.value->>'productCode',i.value->>'productName',i.value->>'unit'
    ), packed AS (
      SELECT COALESCE(max(CASE WHEN progress->>'casesPacked' ~ '^[0-9]+$'
        THEN (progress->>'casesPacked')::numeric ELSE 0::numeric END),0::numeric) quantity
      FROM v2.run_station_progress WHERE facility_id=p_facility_id AND run_id=p_run_id AND station_key='packaging'
    ), packaging AS (
      SELECT (l.value->>'productId')::uuid product_id,l.value->>'productCode' product_code,
        l.value->>'productName' product_name,l.value->>'unit' unit,
        sum((l.value->>'quantity')::numeric*packed.quantity) required
      FROM jsonb_array_elements(p_plan->'packagingPerCase') l(value) CROSS JOIN packed
      GROUP BY l.value->>'productId',l.value->>'productCode',l.value->>'productName',l.value->>'unit'
    ), combined AS (SELECT * FROM recipe_demand UNION ALL SELECT * FROM packaging)
    SELECT product_id,product_code,product_name,unit,sum(required) required
    FROM combined WHERE required>0 GROUP BY product_id,product_code,product_name,unit ORDER BY product_id
  LOOP
    v_required:=v_demand.required; v_uses:='[]'::jsonb;
    FOR v_stage IN
      SELECT s.* FROM v2.run_inventory_staged_supplies s
      WHERE s.facility_id=p_facility_id AND s.run_id=p_run_id
        AND s.planned_product_id=v_demand.product_id
      ORDER BY s.occurred_at,s.id
    LOOP
      v_staged_used:=LEAST(v_required,v_stage.quantity);
      IF v_staged_used>0 THEN
        v_uses:=v_uses||jsonb_build_array(jsonb_build_object(
          'stageId',v_stage.id,'plannedProductId',v_demand.product_id,
          'actualProductId',v_stage.actual_product_id,'quantity',v_staged_used::text));
        v_required:=v_required-v_staged_used;
      END IF;
    END LOOP;
    IF v_required>0 THEN
      v_uses:=v_uses||jsonb_build_array(jsonb_build_object(
        'stageId',NULL,'plannedProductId',v_demand.product_id,
        'actualProductId',v_demand.product_id,'quantity',v_required::text));
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_uses) LOOP
      SELECT * INTO v_actual FROM v2.products WHERE facility_id=p_facility_id
        AND id=(v_line->>'actualProductId')::uuid AND active FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'A staged product is no longer active' USING ERRCODE='40001'; END IF;
      v_required:=(v_line->>'quantity')::numeric;
      INSERT INTO v2.inventory_balances(facility_id,warehouse_id,product_id)
        VALUES(p_facility_id,v_warehouse_id,v_actual.id) ON CONFLICT DO NOTHING;
      SELECT * INTO v_balance FROM v2.inventory_balances WHERE facility_id=p_facility_id
        AND warehouse_id=v_warehouse_id AND product_id=v_actual.id FOR UPDATE;
      SELECT COALESCE(sum(s.quantity),0) INTO v_reserved
      FROM v2.run_inventory_staged_supplies s JOIN v2.runs r
        ON r.facility_id=s.facility_id AND r.id=s.run_id
      WHERE s.facility_id=p_facility_id AND s.warehouse_id=v_warehouse_id
        AND s.actual_product_id=v_actual.id AND r.status<>'completed'
        AND s.run_id<>p_run_id;
      IF (v_line->>'stageId') IS NOT NULL THEN
        SELECT COALESCE(sum(s.quantity-rs.quantity_released),0) INTO v_available
        FROM v2.run_inventory_stage_receipts rs
        JOIN v2.run_inventory_staged_supplies s ON s.facility_id=rs.facility_id AND s.id=rs.staged_supply_id
        WHERE rs.facility_id=p_facility_id AND s.run_id=p_run_id AND s.actual_product_id=v_actual.id;
        -- Staged reservations are owned by this run; allow its accepted amount.
        v_available:=GREATEST(0,v_balance.quantity-v_reserved);
      ELSE
        v_available:=GREATEST(0,v_balance.quantity-v_reserved);
      END IF;
      v_deducted:=LEAST(v_required,v_available);
      IF (v_line->>'stageId') IS NOT NULL THEN
        SELECT quantity INTO STRICT v_stage_quantity FROM v2.run_inventory_staged_supplies
          WHERE facility_id=p_facility_id AND id=(v_line->>'stageId')::uuid;
        INSERT INTO v2.run_inventory_stage_receipts(
          facility_id,staged_supply_id,actual_product_id,quantity_used,quantity_released,completed_at
        ) VALUES(p_facility_id,(v_line->>'stageId')::uuid,v_actual.id,v_deducted,
          v_stage_quantity-v_deducted,v_now);
      END IF;
      IF v_deducted>0 THEN
        IF v_balance.revision>=9007199254740991 THEN RAISE EXCEPTION 'Inventory revision is exhausted' USING ERRCODE='22003'; END IF;
        UPDATE v2.inventory_balances SET quantity=quantity-v_deducted,revision=revision+1,updated_at=v_now
        WHERE facility_id=p_facility_id AND warehouse_id=v_warehouse_id AND product_id=v_actual.id;
        v_movement:=gen_random_uuid();
        INSERT INTO v2.inventory_movements(
          facility_id,warehouse_id,product_id,movement_group_id,movement_type,quantity_delta,
          reason,actor_id,command_id,occurred_at,run_id,planned_product_id
        ) VALUES(p_facility_id,v_warehouse_id,v_actual.id,v_movement,'run_consumption',-v_deducted,
          'Run completion inventory use',p_actor_id,
          'run:'||p_run_id::text||':'||v_demand.product_id::text||':'||v_actual.id::text,
          v_now,p_run_id,v_demand.product_id);
      END IF;
      -- The per-product line below is summarized after all stage substitutions.
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
        'productId',v_actual.id,'productCode',v_actual.code,'productName',v_actual.name,
        'unit',v_actual.base_unit,'plannedProductId',v_demand.product_id,
        'plannedProductCode',v_demand.product_code,'required',(v_line->>'quantity'),
        'deducted',v_deducted::text,'shortfall',(v_required-v_deducted)::text,
        'staged',((v_line->>'stageId') IS NOT NULL),'stageId',v_line->'stageId'
      ));
    END LOOP;
  END LOOP;
  FOR v_stage IN
    SELECT s.* FROM v2.run_inventory_staged_supplies s
    WHERE s.facility_id=p_facility_id AND s.run_id=p_run_id
      AND NOT EXISTS (SELECT 1 FROM v2.run_inventory_stage_receipts r
        WHERE r.facility_id=s.facility_id AND r.staged_supply_id=s.id)
    ORDER BY s.occurred_at,s.id
  LOOP
    INSERT INTO v2.run_inventory_stage_receipts(
      facility_id,staged_supply_id,actual_product_id,quantity_used,quantity_released,completed_at
    ) VALUES(p_facility_id,v_stage.id,v_stage.actual_product_id,0,v_stage.quantity,v_now);
  END LOOP;
  v_detail:=jsonb_build_object('status','completed','runId',p_run_id,
    'warehouseId',v_warehouse_id,'warehouseName',v_warehouse_name,'lines',v_lines,
    'occurredAt',to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  INSERT INTO v2.run_inventory_consumptions(facility_id,run_id,warehouse_id,actor_id,details,occurred_at)
    VALUES(p_facility_id,p_run_id,v_warehouse_id,p_actor_id,v_detail,v_now);
  RETURN v_detail;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA v2 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v2 FROM PUBLIC;

COMMENT ON TABLE v2.inventory_lots IS
  'V2-only stock lots. Positive ledger movements receive lot provenance; negative movements consume oldest available lots transactionally.';
COMMENT ON TABLE v2.inventory_movement_lot_allocations IS
  'Immutable lot-level allocations that reconcile each new inventory movement to receipt/preparation/transfer lots.';
COMMENT ON TABLE v2.inventory_cycle_counts IS
  'Reviewed absolute physical counts fenced by captured balance revisions and explicit Apply acknowledgement.';
COMMENT ON TABLE v2.inventory_preparations IS
  'Atomic V2 mix preparation receipts calculated from explicitly linked ingredient and prepared-stock products.';

COMMIT;
