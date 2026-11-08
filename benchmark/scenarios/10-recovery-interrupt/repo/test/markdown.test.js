import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toHtml } from '../lib/markdown.js'

test('headings and paragraphs', () => {
  assert.equal(toHtml('# Title\n\nHello\nworld & <you>'), '<h1>Title</h1>\n<p>Hello world &amp; &lt;you&gt;</p>')
})
