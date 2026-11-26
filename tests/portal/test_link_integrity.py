"""Exercise the generator's link contract with malformed documentation."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("build_portal", Path(__file__).parents[2] / "scripts/build-portal.py")
portal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portal)


class GuideLinks(unittest.TestCase):
    def test_cross_document_fragment_survives(self):
        self.assertEqual(
            portal.rewrite_guide_links('<a href="getting-started.html#configuration-layering">Config</a>', "index"),
            '<a href="#guide-getting-started/configuration-layering" data-guide-target="getting-started">Config</a>',
        )

    def test_same_document_fragment_has_document_identity(self):
        self.assertIn('href="#guide-agent-guide/setup"', portal.rewrite_guide_links('<a href="#setup">Setup</a>', "agent-guide"))

    def test_unmapped_document_fails(self):
        with self.assertRaisesRegex(RuntimeError, "Unmapped"):
            portal.rewrite_guide_links('<a href="new-guide.html#setup">Setup</a>', "index")

    def test_missing_fragment_fails(self):
        with self.assertRaisesRegex(RuntimeError, "Missing guide anchor"):
            portal.validate_portal_links('<article data-guide-panel="index"><a href="#guide-index/missing">Lost</a></article>')

    def test_missing_document_fails(self):
        with self.assertRaisesRegex(RuntimeError, "Missing guide document"):
            portal.validate_portal_links('<a href="#guide-unknown">Lost</a>')

    def test_fragment_is_scoped_to_target_document(self):
        with self.assertRaisesRegex(RuntimeError, "Missing guide anchor"):
            portal.validate_portal_links('<article data-guide-panel="index"><i id="setup"></i><a href="#guide-agent-guide/setup">Lost</a></article><article data-guide-panel="agent-guide"></article>')

    def test_missing_portal_anchor_fails(self):
        with self.assertRaisesRegex(RuntimeError, "Missing portal anchor"):
            portal.validate_portal_links('<a href="#missing">Lost</a>')

    def test_unserved_internal_path_fails(self):
        with self.assertRaisesRegex(RuntimeError, "Unserved internal link"):
            portal.validate_portal_links('<a href="/missing">Lost</a>')

    def test_existing_fragment_passes(self):
        portal.validate_portal_links('<article data-guide-panel="index"><a href="#guide-index/setup">Setup</a><i id="setup"></i></article>')


if __name__ == '__main__':
    unittest.main()
