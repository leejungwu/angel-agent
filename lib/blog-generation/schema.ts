export type Draft = {
  title: string;
  intro: string;
  sections: { heading: string; body: string; imageAssetId: null }[];
  closing: string;
};

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "intro", "sections", "closing"],
  properties: {
    title: { type: "string" },
    intro: { type: "string" },
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body", "imageAssetId"],
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          imageAssetId: { type: "null" },
        },
      },
    },
    closing: { type: "string" },
  },
};

export function isDraft(value: unknown): value is Draft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return (
    Object.keys(draft).every((key) => DRAFT_SCHEMA.required.includes(key)) &&
    typeof draft.title === "string" &&
    typeof draft.intro === "string" &&
    typeof draft.closing === "string" &&
    Array.isArray(draft.sections) &&
    draft.sections.length > 0 &&
    draft.sections.every((section: unknown) => {
      if (typeof section !== "object" || section === null || Array.isArray(section)) return false;
      const item = section as Record<string, unknown>;
      return Object.keys(item).every((key) => DRAFT_SCHEMA.properties.sections.items.required.includes(key)) &&
        typeof item.heading === "string" &&
        typeof item.body === "string" && item.imageAssetId === null;
    })
  );
}

