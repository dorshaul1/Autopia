import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, stats } from '../bin/csvstat.js'

test('parses quotes', () => assert.deepEqual(parseCsv('a,b\n"x, y","q ""z"""\n'), [['a', 'b'], ['x, y', 'q "z"']]))
test('stats', () => assert.deepEqual(stats([['n', 's'], ['1', 'a'], ['3', '']]), ['n: count=2 mean=2.00 min=1 max=3']))
