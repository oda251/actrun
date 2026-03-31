export interface PlainInput {
  type: "plain";
  value: string;
}

export interface TranscriptCitation {
  type: "transcript";
  excerpt: string;
}

export interface UriCitation {
  type: "uri";
  source: string;
  excerpt: string;
}

export interface CommandCitation {
  type: "command";
  command: string;
  excerpt: string;
}

export type Citation = TranscriptCitation | UriCitation | CommandCitation;

export interface EvidencedInput {
  type: "evidenced";
  body: string;
  citations: Citation[];
}

export type InputEntry = PlainInput | EvidencedInput;

export interface InputSpec {
  description: string;
  type: "plain" | "evidenced";
}
