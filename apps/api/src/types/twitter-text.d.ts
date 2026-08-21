declare module "twitter-text" {
  export interface ParsedTweet {
    weightedLength: number;
    valid: boolean;
    permillage: number;
    validRangeStart: number;
    validRangeEnd: number;
    displayRangeStart: number;
    displayRangeEnd: number;
  }

  export function parseTweet(text: string): ParsedTweet;
}
