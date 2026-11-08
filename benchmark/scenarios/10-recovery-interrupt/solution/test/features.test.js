import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toHtml } from '../lib/markdown.js'

test('list', () => assert.match(toHtml('- a\n- b'), /<li>a<\/li>/))
test('code', () => assert.equal(toHtml('`x`'), '<p><code>x</code></p>'))
test('bold', () => assert.equal(toHtml('**x**'), '<p><strong>x</strong></p>'))
test('link', () => assert.equal(toHtml('[a](https://b.c)'), '<p><a href="https://b.c">a</a></p>'))
test('unsafe link', () => assert.doesNotMatch(toHtml('[a](javascript:x)'), /<a/))
