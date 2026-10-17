import importlib.util
from pathlib import Path
import tempfile
import shutil
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('compare_apks', Path(__file__).with_name('compare-apks.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class CompareApksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def apk(self, name, entries):
        path = Path(self.temp.name) / name
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('AndroidManifest.xml', b'manifest fixture')
            for key, value in entries:
                z.writestr(key, value)
        return path

    def test_exact_reference(self):
        p = self.apk('a.apk', [('classes.dex', b'code')])
        x = audit.inventory(p)
        self.assertTrue(audit.compare(x, x)['exact_file_match'])

    def test_changed_payload_and_added_library(self):
        a = audit.inventory(self.apk('a.apk', [('classes.dex', b'changed'), ('lib/x.so', b'native')]))
        b = audit.inventory(self.apk('b.apk', [('classes.dex', b'old'), ('assets/old', b'old')]))
        diff = audit.compare(a, b)
        self.assertFalse(diff['exact_file_match'])
        self.assertEqual(diff['changed'], ['classes.dex'])
        self.assertEqual(diff['added'], ['lib/x.so'])
        self.assertEqual(diff['removed'], ['assets/old'])

    def test_duplicate_entries_rejected(self):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            p = self.apk('a.apk', [('classes.dex', b'1'), ('classes.dex', b'2')])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            audit.inventory(p)

    def test_budget_rejected_before_read(self):
        p = self.apk('a.apk', [('classes.dex', b'123')])
        with self.assertRaisesRegex(ValueError, 'budget'):
            audit.inventory(p, max_uncompressed=1)

    def test_signature_failure_retained(self):
        p = self.apk('a.apk', [])
        result = audit.verify(p, shutil.which('false'))
        self.assertFalse(result['valid'])
        self.assertNotEqual(result['exit_code'], 0)

    def test_traversal_name_is_never_extracted(self):
        p = self.apk('a.apk', [('../outside', b'payload')])
        self.assertIn('../outside', audit.inventory(p)['entries'])
        self.assertFalse((Path(self.temp.name).parent / 'outside').exists())


if __name__ == '__main__':
    unittest.main()
