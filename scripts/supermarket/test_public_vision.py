"""Local host boundary checks. No CLI/model process or network is invoked."""
import importlib.util, json, hashlib, tempfile, unittest, sqlite3
from pathlib import Path
from PIL import Image

spec=importlib.util.spec_from_file_location('reader',Path(__file__).with_name('read-public-flyer-once.py'))
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)


class PublicVisionTests(unittest.TestCase):
    def iy_fixture(self,root,large=False):
        source=root/'source.sqlite';db=sqlite3.connect(source)
        db.executescript('CREATE TABLE flyer_discovered_editions(edition_id,store,source,from_day,until_day);CREATE TABLE flyer_discovered_pages(edition_id,ordinal,source,sha256,state,body);')
        db.execute('INSERT INTO flyer_discovered_editions VALUES(?,?,?,?,?)',('edition','iy','https://promo.hatobase.jp/flyers/00521/9999/12345','2026-11-25','2026-11-27'))
        for i in (1,2):
            p=root/f'p{i}.jpg';Image.new('RGB',(7510,5375) if large else (1900,1800),'white').save(p)
            b=p.read_bytes();db.execute('INSERT INTO flyer_discovered_pages VALUES(?,?,?,?,?,?)',('edition',i,f'https://content.hatobase.jp/flyer_details/123/page{i}.jpg',hashlib.sha256(b).hexdigest(),'saved',b))
        db.commit();db.close();return source
    def fixture(self,root):
        pages=[]
        for i,face in enumerate(('front','back')):
            p=root/(face+'.jpg');Image.new('RGB',(1900,1800),'white').save(p)
            pages.append(dict(logical_face=face,file=p.name,source='https://ok-corporation.jp/archives/001/202611/'+str(i+1)*8+'.jpg',sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
        manifest=root/'manifest.json'
        manifest.write_text(json.dumps(dict(schema=1,store='ok',qa_truth='DO_NOT_SEND_QA',issues=[dict(pages=pages)])))
        return manifest

    def test_all_faces_all_pixels_with_no_arbitrary_manifest_or_qa_fields(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as t:
            self.assertTrue(Path(t).resolve().is_relative_to(Path(__file__).resolve().parents[2]))
            root=Path(t);manifest=self.fixture(root);out=root/'out';reader.prepare(manifest,out)
            for face in ('front','back'):
                folder=out/face;meta=json.loads((folder/'input.json').read_text())
                for x in (0,1599,1600,1899):
                    for y in (0,1599,1600,1799):
                        self.assertTrue(any(a['origin'][0]<=x<a['origin'][0]+a['size'][0] and a['origin'][1]<=y<a['origin'][1]+a['size'][1] for a in meta['tiles']))
                self.assertNotIn('DO_NOT_SEND_QA',(folder/'prompt.txt').read_text(encoding='utf-8'))
                (folder/'started.json').write_text('{}')
                with self.assertRaisesRegex(ValueError,'ALREADY_STARTED'):reader.run(folder)
            with self.assertRaises(FileExistsError):reader.prepare(manifest,out)

    def test_nonpublic_source_and_hash_drift_are_rejected_before_preparation(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as t:
            self.assertTrue(Path(t).resolve().is_relative_to(Path(__file__).resolve().parents[2]))
            root=Path(t);manifest=self.fixture(root);m=json.loads(manifest.read_text())
            m['issues'][0]['pages'][0]['source']='https://private.invalid/x.jpg';manifest.write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'PUBLIC_SOURCE_SCOPE'):reader.prepare(manifest,root/'out')
            self.assertFalse((root/'out').exists())

    def test_iy_requires_saved_same_store_both_faces_and_retains_full_resolution_coverage(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as t:
            root=Path(t);source=self.iy_fixture(root,large=True);before=hashlib.sha256(source.read_bytes()).hexdigest()
            reader.prepare_iy(source,root,root/'out')
            for face in ('front','back'):
                folder=root/'out'/face;meta=json.loads((folder/'input.json').read_text())
                self.assertEqual(meta['store'],'iy');self.assertEqual(meta['original_size'],[7510,5375]);self.assertEqual(len(meta['tiles']),24)
                self.assertEqual((meta['document_from'],meta['document_until']),('2026-11-25','2026-11-27'))
                for x in (0,1599,1600,7509):
                    for y in (0,1599,1600,5374):self.assertTrue(any(a['origin'][0]<=x<a['origin'][0]+a['size'][0] and a['origin'][1]<=y<a['origin'][1]+a['size'][1] for a in meta['tiles']))
                (folder/'started.json').write_text('{}')
                with self.assertRaisesRegex(ValueError,'ALREADY_STARTED'):reader.run(folder)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)

    def test_iy_source_extension_cannot_bypass_regular_ok_manifest_gate(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as t:
            root=Path(t);m=self.fixture(root);obj=json.loads(m.read_text());obj['store']='iy';m.write_text(json.dumps(obj))
            with self.assertRaisesRegex(ValueError,'PUBLIC_MANIFEST_SCOPE'):reader.prepare(m,root/'out')
        self.assertFalse(reader.source_allowed('iy','https://content.hatobase.jp/flyer_details/123/page.jpg','https://promo.hatobase.jp/flyers/00522/9999/12345'))
        self.assertFalse(reader.source_allowed('iy','https://private.invalid/f.jpg','https://promo.hatobase.jp/flyers/00521/9999/12345'))
        self.assertFalse(reader.source_allowed('iy','https://content.hatobase.jp/flyer_details/123/page.jpg?x=1','https://promo.hatobase.jp/flyers/00521/9999/12345'))

    def test_iy_failed_edited_missing_pages_and_source_hash_are_not_prepared(self):
        for mode in ('failed','wrong_store','missing','hash'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as t:
                root=Path(t);source=self.iy_fixture(root);db=sqlite3.connect(source)
                if mode=='failed':db.execute("UPDATE flyer_discovered_pages SET state='failed' WHERE ordinal=2")
                if mode=='wrong_store':db.execute("UPDATE flyer_discovered_editions SET source='https://promo.hatobase.jp/flyers/00522/9999/12345'")
                if mode=='missing':db.execute('DELETE FROM flyer_discovered_pages WHERE ordinal=2')
                if mode=='hash':db.execute("UPDATE flyer_discovered_pages SET sha256=? WHERE ordinal=1",('f'*64,))
                db.commit();db.close()
                with self.assertRaises(ValueError):reader.prepare_iy(source,root,root/'out')
                self.assertFalse((root/'out').exists())

    def test_iy_prepared_prompt_or_overview_drift_rejected_before_cli(self):
        for target in ('prompt.txt','overview.jpg'):
            with self.subTest(target=target),tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[2]) as t:
                root=Path(t);source=self.iy_fixture(root);reader.prepare_iy(source,root,root/'out');folder=root/'out/front'
                (folder/target).write_bytes(b'synthetic drift')
                with self.assertRaisesRegex(ValueError,'PREPARED_IY_HASH'):reader.run(folder)
                self.assertFalse((folder/'started.json').exists())


if __name__=='__main__':unittest.main()
