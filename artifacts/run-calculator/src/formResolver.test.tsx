import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { formResolver } from "./formResolver";
import { DEFAULT_VALUES, type FormValues } from "./types";

afterEach(cleanup);

function OperationalForm({
  mode,
  onSubmit,
}: {
  mode: "onChange" | "onSubmit";
  onSubmit: (values: FormValues) => void;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: formResolver,
    defaultValues: DEFAULT_VALUES,
    mode,
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>
        Cases needed
        <input type="number" {...register("casesNeeded", { valueAsNumber: true })} />
      </label>
      {errors.casesNeeded && <p role="alert">{errors.casesNeeded.message}</p>}
      <button type="submit">Save</button>
    </form>
  );
}

describe("operational form resolver compatibility", () => {
  it("returns field errors for invalid numeric and nested recipe values without rejecting", async () => {
    const result = await formResolver(
      {
        ...DEFAULT_VALUES,
        casesNeeded: -1,
        doughRecipe: [{ ingredient: "Flour", lbs: -1 }],
      },
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );

    expect(result.values).toEqual({});
    expect(result.errors.casesNeeded?.type).toBe("too_small");
    expect(result.errors.doughRecipe?.[0]?.lbs?.type).toBe("too_small");
  });

  it.each(["onChange", "onSubmit"] as const)(
    "shows invalid-input feedback and submits corrected values in %s mode",
    async (mode) => {
      const onSubmit = vi.fn();
      const user = userEvent.setup();
      render(<OperationalForm mode={mode} onSubmit={onSubmit} />);
      const input = screen.getByRole("spinbutton", { name: "Cases needed" });

      await user.clear(input);
      await user.type(input, "-1");
      if (mode === "onChange") {
        // The calculator validates as the operator types, before submission.
        expect((await screen.findByRole("alert")).textContent).not.toBe("");
      }
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect((await screen.findByRole("alert")).textContent).not.toBe("");
      expect(onSubmit).not.toHaveBeenCalled();

      await user.clear(input);
      await user.type(input, "42");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ casesNeeded: 42 });
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});
