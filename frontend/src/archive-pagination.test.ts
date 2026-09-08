import test from 'node:test';import assert from 'node:assert/strict';
import {ARCHIVE_PAGE_SIZE,archivePageCount,archivePageItems,archivePageTokens,clampArchivePage,normalizeArchiveHistory} from './archive-pagination.js';
const cycles=(count:number)=>Array.from({length:count},(_,i)=>({cycleId:`c${i}`,finishedAt:new Date(i*1000).toISOString()}));
test('page size is fixed at ten and empty through ten items need one page',()=>{assert.equal(ARCHIVE_PAGE_SIZE,10);for(const n of [0,1,10])assert.equal(archivePageCount(n),1)});
test('eleven and twenty items create exactly two pages',()=>{assert.equal(archivePageCount(11),2);assert.equal(archivePageCount(20),2);assert.equal(archivePageItems(cycles(20),2).length,10)});
test('more than twenty items remain reachable',()=>{const h=cycles(27);assert.equal(archivePageCount(h.length),3);assert.deepEqual(archivePageItems(h,3).map(x=>x.cycleId),['c20','c21','c22','c23','c24','c25','c26'])});
test('history is deduplicated and newest-first despite malformed legacy rows',()=>{const h=normalizeArchiveHistory([{cycleId:'old',startedAt:'2026-01-01'},null,{cycleId:'new',finishedAt:'2026-02-01'},{cycleId:'old',finishedAt:'2027-01-01'},{legacy:true}]);assert.deepEqual(h.map(x=>x.cycleId),['new','old'])});
test('page clamps after history shrinks while valid selection pages remain',()=>{assert.equal(clampArchivePage(3,11),2);assert.equal(clampArchivePage(2,30),2);assert.equal(clampArchivePage(0,30),1)});
test('large archives use compact page tokens with ellipses',()=>{assert.deepEqual(archivePageTokens(5,12),[1,'ellipsis',4,5,6,'ellipsis',12]);assert.deepEqual(archivePageTokens(1,12),[1,2,'ellipsis',12])});
