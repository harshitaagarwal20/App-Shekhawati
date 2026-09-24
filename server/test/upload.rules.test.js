/**
 * File uploads leave the browser as multipart. No database, no browser.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS WORTH A TEST OF ITS OWN
 *
 *  The API client sets `Content-Type: application/json` on the axios instance,
 *  which is right for every JSON endpoint and quietly wrong for the two that
 *  send a file. Axios 1.x reads that header before it decides what the body is:
 *
 *      if (isFormData) {
 *        return hasJSONContentType ? JSON.stringify(formDataToJSON(data)) : data;
 *      }
 *
 *  So a FormData carrying a File was not sent as multipart at all. It was
 *  flattened to JSON, in which a File serialises to `{}`. The CSV import
 *  answered "No file was sent. Choose a CSV file to import." with the file
 *  plainly sitting in the file picker, and the order attachment upload failed
 *  the same way.
 *
 *  NOTHING THREW. The request was well-formed, the server's refusal was
 *  correct, and every message on the screen pointed away from the cause - which
 *  is exactly the kind of failure a test has to hold still.
 *
 *  The rule is one line in an interceptor and belongs to axios's behaviour
 *  rather than to ours, so it is asserted against the real axios: a stub
 *  adapter captures what the body would have been, and the test reads it. Both
 *  call sites (dataImports.send, orders.attachments.upload) already carry
 *  comments saying they must not set the header; only the interceptor can
 *  delete a default set on the instance, so only the interceptor is tested.
 *
 *  This file lives in `server/test` and reaches into `client/src` for the same
 *  reason urlParams.rules.test.js does: the client has no test runner, and this
 *  runs on a bare Node install with no database.
 * ---------------------------------------------------------------------------
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import axios from 'axios';

/*
 * api.js cannot be imported here - it reads `import.meta.env`, which is Vite's
 * and does not exist on a bare Node run. So the file is read as text for the
 * one assertion that has to be about OUR code, and the behavioural tests below
 * pin axios's half of the contract against the real axios.
 */
const apiSource = readFileSync(
  new URL('../../client/src/services/api.js', import.meta.url),
  'utf8',
);

/**
 * The instance the client builds, with an adapter that answers instead of
 * making a request - so the assertions read the body axios actually produced.
 */
function client() {
  const api = axios.create({ headers: { 'Content-Type': 'application/json' } });

  // The rule under test, copied from client/src/services/api.js.
  api.interceptors.request.use((config) => {
    config.headers.Authorization = 'Bearer test';
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      config.headers.delete('Content-Type');
    }
    return config;
  });

  const sent = {};
  api.defaults.adapter = async (config) => {
    sent.body = config.data;
    sent.contentType = config.headers.getContentType();
    return { data: { success: true, data: {} }, status: 200, headers: {}, config };
  };
  return { api, sent };
}

const csvUpload = () => {
  const body = new FormData();
  body.append('file', new File(['Style No,Status\nTP-1,ACTIVE\n'], 'styles.csv', { type: 'text/csv' }));
  body.append('mode', 'upsert');
  body.append('dryRun', 'true');
  return body;
};

describe('Uploads - a file reaches the server as a file', () => {
  test('the API client deletes the Content-Type default for a FormData body', () => {
    const interceptor = apiSource.slice(apiSource.indexOf('api.interceptors.request.use'));
    const rule = interceptor.slice(0, interceptor.indexOf('return config;'));

    assert.match(
      rule,
      /instanceof FormData/,
      'client/src/services/api.js no longer detects a FormData body in its request interceptor',
    );
    assert.match(
      rule,
      /headers\.delete\(\s*'Content-Type'\s*\)/,
      "the JSON Content-Type default is no longer deleted for uploads - axios will flatten the "
        + 'FormData to JSON and the file will serialise to {}',
    );
  });

  test('a CSV import is still FormData when it leaves axios', async () => {
    const { api, sent } = client();
    await api({ method: 'POST', url: '/imports/styles', data: csvUpload() });

    assert.ok(
      sent.body instanceof FormData,
      'the import body was converted out of FormData - the file will not reach multer',
    );
  });

  test('the file survives, rather than serialising to an empty object', async () => {
    const { api, sent } = client();
    await api({ method: 'POST', url: '/imports/styles', data: csvUpload() });

    // The exact symptom of the bug: JSON.stringify of the flattened form was
    // {"file":{},"mode":"upsert","dryRun":"true"} - every field but the one
    // that mattered.
    assert.notEqual(typeof sent.body, 'string', 'the body was stringified to JSON');
    assert.ok(sent.body.get('file') instanceof File, 'the file did not survive the transform');
    assert.equal(sent.body.get('mode'), 'upsert');
  });

  test('the JSON content-type is not carried into a multipart request', async () => {
    const { api, sent } = client();
    await api({ method: 'POST', url: '/imports/styles', data: csvUpload() });

    assert.ok(
      !String(sent.contentType ?? '').includes('application/json'),
      'application/json on a multipart body is what triggers the flattening',
    );
  });

  test('an order attachment upload is covered by the same rule', async () => {
    const { api, sent } = client();
    const body = new FormData();
    body.append('file', new File(['%PDF-1.4'], 'po.pdf', { type: 'application/pdf' }));
    body.append('note', 'buyer PO');
    await api({ method: 'POST', url: '/orders/abc/attachments', data: body });

    assert.ok(sent.body instanceof FormData);
    assert.ok(sent.body.get('file') instanceof File);
  });

  test('JSON requests are left exactly as they were', async () => {
    const { api, sent } = client();
    await api({ method: 'POST', url: '/auth/login', data: { username: 'u', password: 'p' } });

    assert.equal(sent.body, '{"username":"u","password":"p"}');
    assert.ok(String(sent.contentType).includes('application/json'));
  });
});
