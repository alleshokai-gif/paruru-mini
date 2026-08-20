'use strict';

const assert=require('node:assert/strict');
const {PET_HEALTH_GVIZ_HEADERS,buildPetHealthGvizUrl,parsePetHealthGvizRows}=require('../scripts/pet-health-gviz-probe.js');

const headers=PET_HEALTH_GVIZ_HEADERS.Pet_Health_Events;
const data=['event-1','home-main','popio','meal'];
const shapeA=[headers.slice(),data.slice()];
const shapeB=[[],headers.map((value)=>({v:value})),data.map((value)=>({v:value}))];
const parsedA=parsePetHealthGvizRows(shapeA,headers);
const parsedB=parsePetHealthGvizRows(shapeB,headers);

assert.equal(parsedA.headerIndex,0,'shape A header is discovered at row 0');
assert.equal(parsedB.headerIndex,1,'shape B header is discovered after a blank row');
assert.deepEqual(parsedA.headers,headers,'shape A canonical header');
assert.deepEqual(parsedB.headers,headers,'shape B canonical header');
assert.deepEqual(parsedA.dataRows,parsedB.dataRows,'shape A and B must produce the same logical rows');
assert.equal(parsedA.dataRowCount,1,'shape A data count');
assert.equal(parsedB.dataRowCount,1,'shape B data count');
assert.throws(()=>parsePetHealthGvizRows([['wrong'],data],headers),/GVIZ_HEADER_MISMATCH/,'unknown header must fail closed');
assert.throws(()=>parsePetHealthGvizRows([headers,headers],headers),/GVIZ_HEADER_MISMATCH/,'duplicate canonical header must fail closed');

const url=new URL(buildPetHealthGvizUrl('https://docs.google.com/spreadsheets/d/example/gviz/tq','Pet_Health_Events','A:Z'));
assert.equal(url.searchParams.get('headers'),'1','GViz query must set headers=1');
assert.equal(url.searchParams.get('sheet'),'Pet_Health_Events','GViz query carries the requested Sheet');
assert.equal(url.searchParams.get('range'),'A:Z','GViz query carries the requested range');

console.log('PASS Pet Health GViz probe headers=1, canonical header discovery, and shape A/B fixtures');
