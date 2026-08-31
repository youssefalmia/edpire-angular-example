/**
 * Where the browser talks to Edpire.
 *
 * Two round trips leave the browser and go to Edpire directly, rather than
 * through your server: the player fetching its content, and the player
 * submitting. Both are authorised by the embed token, not by your API key, so
 * there is nothing secret in them -- but they do need to know which host to
 * reach, and they are the reason the origin allow-list exists at all.
 *
 * Leave this alone unless you run a staging or self-hosted Edpire.
 */
export const EDPIRE_BASE_URL = 'https://edpire.com'
