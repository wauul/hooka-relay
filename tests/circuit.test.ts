import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beforeAttempt,afterAttempt,COOLDOWN_MS,type Circuit} from '../lib/circuitBreaker';
const initial:Circuit={circuitState:'CLOSED',consecutiveFailures:0,circuitOpenedAt:null};
test('opens exactly on fifth consecutive failure',()=>{let c=initial;for(let i=1;i<=5;i++){c=afterAttempt(c,false,new Date(1000));assert.equal(c.consecutiveFailures,i);assert.equal(c.circuitState,i===5?'OPEN':'CLOSED');}assert.equal(beforeAttempt(c,new Date(2000)).allowed,false);});
test('one recovery probe after cooldown, success closes and resets',()=>{const open:Circuit={circuitState:'OPEN',consecutiveFailures:5,circuitOpenedAt:new Date(1000)};assert.equal(beforeAttempt(open,new Date(1000+COOLDOWN_MS-1)).allowed,false);const gate=beforeAttempt(open,new Date(1000+COOLDOWN_MS));assert.equal(gate.state.circuitState,'HALF_OPEN');assert.equal(beforeAttempt(gate.state).allowed,false);assert.deepEqual(afterAttempt(gate.state,true),initial);});
test('failed probe restarts cooldown',()=>{const time=new Date();const c=afterAttempt({...initial,circuitState:'HALF_OPEN',consecutiveFailures:5},false,time);assert.equal(c.circuitState,'OPEN');assert.equal(c.circuitOpenedAt,time);assert.equal(beforeAttempt(c,new Date(time.getTime()+1)).allowed,false);});
test('success breaks consecutive failure sequence',()=>{let c=afterAttempt(initial,false);c=afterAttempt(c,true);assert.deepEqual(c,initial);});
