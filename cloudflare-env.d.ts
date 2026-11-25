declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    KALSHI_API_KEY_ID?: string;
    KALSHI_PRIVATE_KEY_PEM?: string;
  }
}
