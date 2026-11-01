// What kind of refusal a response is. The owner's line (2026-11-01): Dapi works
// through blocks with what Apify provides (new IPs, datacenter and residential proxies,
// sessions, waiting out a check that clears itself), and sets aside any check that
// wants a human to act: a CAPTCHA, a "verify you are human" box, press-and-hold.
// Shared by the investigator, the reachability probe and the frame.

// A page that is a bot check rather than the site's content. Matched on the title and
// on markers only challenge pages carry: Cloudflare injects its challenge-platform
// script into ordinary pages too, so that alone proves nothing.
const CHECK_TITLE = /<title[^>]*>\s*(just a moment|attention required|access denied|security check|one more step|verify(ing)? you are human|are you a (ro)?bot|robot check|captcha|pardon our interruption|request blocked|403 forbidden|too many requests)/i;
const CHECK_MARKERS = /cf_chl_opt|cf-chl-widget|id="challenge-form"|captcha-delivery\.com|px-captcha|_pxCaptcha|awswaf[^"]*captcha/i;

// Inside a check: signs that it wants a person to click, solve or hold something.
const HUMAN = [
  [/cf-turnstile|challenges\.cloudflare\.com\/turnstile|verify (that )?you are (a )?human/i, 'a "verify you are human" check'],
  [/g-recaptcha|google\.com\/recaptcha|recaptcha\/api\.js/i, 'a reCAPTCHA'],
  [/hcaptcha\.com|h-captcha/i, 'an hCaptcha'],
  [/captcha-delivery\.com/i, 'a DataDome CAPTCHA'],
  [/px-captcha|_pxCaptcha|press (&|&amp;) hold/i, 'a press-and-hold check'],
  [/awswaf[^"]*captcha/i, 'an AWS WAF CAPTCHA'],
  [/i'?m not a robot|enter the characters you see|solve the (puzzle|challenge)/i, 'a CAPTCHA'],
];

const REFUSED = new Set([401, 403, 407, 429, 503]);

// Returns null when the response is the site's content, otherwise
// { kind: 'human', what } (set aside) or { kind: 'blocked', what } (try a new IP).
export function classifyBlock({ status = 200, body = '' }) {
  const head = String(body ?? '').slice(0, 40_000);
  const refused = REFUSED.has(status);
  const check = CHECK_TITLE.test(head) || CHECK_MARKERS.test(head);
  if (!refused && !check) return null;
  // A CAPTCHA in an ordinary page's footer form doesn't count: only inside a check.
  const human = HUMAN.find(([re]) => re.test(head));
  if (human && (check || refused)) return { kind: 'human', what: human[1] };
  return { kind: 'blocked', what: check ? 'a bot-check page' : `HTTP ${status}` };
}
