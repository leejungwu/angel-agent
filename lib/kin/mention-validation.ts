import type { KinAnswer } from "./generate";
import type { MentionLevel } from "./presets";

export function kinMentionValidationErrors(draft: KinAnswer, product: { name: string | null; brand: string | null } | null, level: MentionLevel) {
  const normalize = (text: string) => text.normalize("NFC").toLowerCase();
  const answer = normalize(draft.answer);
  const present = (text: string | null | undefined) => !!text?.trim() && answer.includes(normalize(text.trim()));
  const namePresent = present(product?.name);
  const brandPresent = present(product?.brand);
  const actuallyMentioned = namePresent || brandPresent;
  const errors: string[] = [];
  if (product && level === "direct" && !namePresent) errors.push("direct_product_name_missing");
  if (level === "none" && actuallyMentioned) errors.push("forbidden_product_or_brand");
  if (!product && draft.productMentioned) errors.push("productMentioned_without_product");
  else if (draft.productMentioned !== actuallyMentioned) errors.push("productMentioned_mismatch");
  return errors;
}
