import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './native-activation-fixture.mjs';
import {createNativeRetainedStore} from './native-adoption-retained.mjs';
test('physical wiki tsvector survives exact retained import, encrypted reopen and unknown-column rejection',async t=>{
 const f=await fixture(t,'gmail_controlled_sender');
 const page=f.snapshot.retained.wiki_pages[0];page.row.search_vector="'origin':1A 'retain':2B";f.refresh();
 await f.run();await f.restart();const retained=createNativeRetainedStore({store:f.store});
 const read=await retained.readPage(f.scope,'wiki_pages',0,async()=>{});assert.equal(read.rows[0].row.search_vector,page.row.search_vector);
 const invalid=await fixture(t,'gmail_controlled_recipient');invalid.snapshot.retained.wiki_pages[0].row.unreviewed_column='deny';invalid.refresh();
 await assert.rejects(invalid.run());
});
