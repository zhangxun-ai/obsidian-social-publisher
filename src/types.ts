export type BodySource = "whole" | "section" | "";
export type Originality = "未确认" | "声明原创" | "不声明";

export interface Issue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface Publication {
  title: string;
  id: string;
  /** Vault-relative Markdown path. */
  path: string;
  registered: boolean;
  bodySource: BodySource;
  /** Stable heading key returned by listSections, or a unique legacy heading name. */
  section: string;
  /** Selected Markdown body, without YAML or the selected heading itself. */
  body: string;
  /** Explicitly selected image references, in upload order. First image is the cover. */
  images: string[];
  topics: string[];
  account: string;
  originality: Originality;
  status: string;
  topic: string;
  mtime: number;
  issues: Issue[];
  /** Local image references found in the selected body; these are never auto-selected. */
  candidates: string[];
  raw: string;
  sourceMarkdown: string;
}

export interface MarkdownSection {
  key: string;
  label: string;
  heading: string;
  level: number;
  /** Character offsets in the original Markdown, including YAML. */
  start: number;
  bodyStart: number;
  end: number;
}

export interface PlatformTextResult {
  text: string;
  issues: Issue[];
}

export interface ImageVersion {
  path: string;
  hash: string;
}

export interface ValidationContext {
  duplicateIds?: ReadonlySet<string>;
  missingImages?: ReadonlySet<string>;
  unreadableImages?: ReadonlySet<string>;
}
