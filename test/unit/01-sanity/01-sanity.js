import 'source-map-support/register.js'
import test from 'tape'
import calc from '../../.node/index.js'

test('Sanity Checks', t => {
  t.pass('Template tests are available.')
  t.ok(calc !== undefined, 'Library is instantiated.')
  
  t.ok(calc.add(1,4,4) === 9, `Adding numbers totals 9.`)
  t.ok(calc.avg(1,4,4) === 3, `Averaging numbers totals 3.`)
  t.end()
})