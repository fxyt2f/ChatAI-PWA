"""Regression coverage for working-tree versus published Git bytes."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class PublicationIntegrity(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='chatai-integrity-')
        self.root = Path(self.temporary.name)
        (self.root / 'tests').mkdir()
        shutil.copyfile(Path(__file__).with_name('update-shell-integrity.py'),
                        self.root / 'tests/update-shell-integrity.py')
        self.git('init', '-q')
        self.git('config', 'core.autocrlf', 'true')
        (self.root / 'app.js').write_text(
            'const APP_VERSION = "1.36.1";\nconst APP_CACHE_VERSION = "v1.36.1";\n',
            encoding='utf-8', newline='\n')
        (self.root / 'index.html').write_bytes(b'<title>release</title>\n')
        (self.root / 'dropbox.js').write_bytes(b'const fixture = true;\n')
        (self.root / 'sw.js').write_text(
            "const CACHE_NAME = 'chatai-pwa-cache-v1.36.1';\n"
            "const urlsToCache = ['./', './index.html', './app.js?v=1.36.1', './dropbox.js?v=1.36.1'];\n"
            "// SHELL_INTEGRITY_BEGIN\n// SHELL_INTEGRITY_END\n",
            encoding='utf-8', newline='\n')

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *arguments, env=None):
        return subprocess.run(['git', *arguments], cwd=self.root, env=env,
                              check=True, capture_output=True)

    def integrity(self, *arguments, env=None, success=True):
        result = subprocess.run([sys.executable, '-B', 'tests/update-shell-integrity.py', *arguments],
                                cwd=self.root, env=env, capture_output=True, text=True,
                                encoding='utf-8')
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def stage_shell(self, env=None):
        self.git('add', '--', 'app.js', 'index.html', 'dropbox.js', 'sw.js', env=env)

    def test_clean_files_and_actual_staged_blobs_pass(self):
        self.integrity()
        self.stage_shell()
        self.integrity('--check')
        self.integrity('--check', '--staged')

    def test_crlf_working_copy_is_rejected_before_pinning(self):
        (self.root / 'dropbox.js').write_bytes(b'const fixture = true;\r\n')
        message = self.integrity(success=False)
        self.assertIn('Git clean filters change the published bytes', message)

    def test_stale_staged_asset_fails_despite_a_passing_working_check(self):
        self.integrity()
        self.stage_shell()
        (self.root / 'dropbox.js').write_bytes(b'const fixture = false;\n')
        self.integrity()
        self.integrity('--check')
        # Stage the new manifest but deliberately omit its changed dependency.
        self.git('add', '--', 'sw.js')
        self.integrity('--check', '--staged', success=False)

    def test_isolated_index_checks_new_assets_without_staging_them_normally(self):
        self.integrity()
        release_env = {**os.environ, 'GIT_INDEX_FILE': str(self.root / 'release.index')}
        self.stage_shell(env=release_env)
        self.integrity('--check', '--staged', env=release_env)
        self.assertEqual(self.git('ls-files').stdout, b'')


if __name__ == '__main__':
    unittest.main()
