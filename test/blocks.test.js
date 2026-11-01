import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBlock } from '../src/blocks.js';

test('an ordinary page is not a block, even with a CAPTCHA in a footer form', () => {
  assert.equal(classifyBlock({ status: 200, body: '<title>Acme Ltd</title><form><div class="g-recaptcha"></div></form>' }), null);
});

test("Cloudflare's script on an ordinary page is not a block", () => {
  assert.equal(classifyBlock({ status: 200, body: '<title>Companies</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>' }), null);
});

test('a refusal or a self-clearing check is a block: retry from a fresh IP', () => {
  assert.equal(classifyBlock({ status: 403, body: '<title>403 Forbidden</title>' }).kind, 'blocked');
  assert.equal(classifyBlock({ status: 429, body: 'Too many requests' }).kind, 'blocked');
  assert.equal(
    classifyBlock({ status: 403, body: '<title>Just a moment...</title><script>window._cf_chl_opt={}</script>Verifying you are human.' }).kind,
    'blocked'
  );
});

test('a check that wants a person is set aside', () => {
  assert.equal(classifyBlock({ status: 403, body: '<title>Just a moment...</title><div class="cf-turnstile"></div>Verify you are human' }).kind, 'human');
  assert.equal(classifyBlock({ status: 403, body: '<iframe src="https://geo.captcha-delivery.com/captcha/">' }).kind, 'human');
  assert.equal(classifyBlock({ status: 200, body: '<title>Access denied</title><div id="px-captcha"></div>' }).kind, 'human');
});
