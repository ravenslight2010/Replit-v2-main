import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { formSchema, type FormValues } from "./types";

// Both operational forms already store complete, numeric FormValues. Zod's
// coercion/defaults deliberately accept a wider input type, while the form's
// watch/control API must retain its existing numeric contract. Narrow only
// the resolver's accepted inputs; all values still pass through the schema.
export const formResolver = zodResolver(formSchema) as Resolver<FormValues>;
