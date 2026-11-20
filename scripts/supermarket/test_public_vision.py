"""Local host boundary checks. No CLI/model process or network is invoked."""
import importlib.util, json, hashlib, tempfile, unittest
from pathlib import Path
from PIL import Image

spec=importlib.util.spec_from_file_location('reader',Path(__file__).with_name('read-public-flyer-once.py'))
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)


class PublicVisionTests(unittest.TestCase):
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


if __name__=='__main__':unittest.main()
