import test from 'node:test';
import assert from 'node:assert/strict';
import {japanServiceTime} from './simulation-time.mjs';
import {HOLIDAY_SOURCE,VERIFIED_HOLIDAY_DATES} from '../../bus/providers/tokyu/calendar.js';
const coverage={...HOLIDAY_SOURCE,holidays:VERIFIED_HOLIDAY_DATES};

test('端末のタイムゾーンによらず日本時間と平日・土休日を選ぶ',()=>{
  assert.deepEqual(japanServiceTime(new Date('2026-10-29T04:00:00Z'),coverage),
    {serviceDate:'2026-10-29',minute:780,calendar:'Weekday'});
  for(const date of ['2026-10-31','2026-11-01','2026-11-03'])
    assert.equal(japanServiceTime(new Date(`${date}T04:00:00Z`),coverage).calendar,'SaturdayHoliday');
});

test('03時より前は前営業日の24時台、03時から当日へ切り替える',()=>{
  assert.deepEqual(japanServiceTime(new Date('2026-10-30T15:30:00Z'),coverage),
    {serviceDate:'2026-10-30',minute:1470,calendar:'Weekday'});
  assert.deepEqual(japanServiceTime(new Date('2026-10-30T18:00:00Z'),coverage),
    {serviceDate:'2026-10-31',minute:180,calendar:'SaturdayHoliday'});
});

test('祝日カレンダー対象外を勝手に平日扱いしない',()=>{
  assert.equal(japanServiceTime(new Date('2028-01-03T04:00:00Z'),coverage).calendar,null);
  assert.throws(()=>japanServiceTime(new Date('invalid'),coverage),/DATE_INVALID/);
});
