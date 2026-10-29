"""
Unit tests for NammaBhasha Flask Backend & API Logic.
Verifies Search, Phrase Selection, Categories, Health, and Speech endpoints.
"""

import unittest
import json
from app import app

class NammaBhashaBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.testing = True
        cls.client = app.test_client()

    def test_health_check(self):
        """Test the health check endpoint returns 200 with required metrics."""
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data.get("status"), "healthy")
        self.assertEqual(data.get("app"), "NammaBhasha")
        self.assertTrue(data.get("features", {}).get("search"))
        self.assertTrue(data.get("features", {}).get("phrase_selection"))
        self.assertGreater(data.get("stats", {}).get("phrases", 0), 0)

    def test_get_categories(self):
        """Test categories retrieval with enriched phrase counts."""
        response = self.client.get("/api/categories")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)
        for cat in data:
            self.assertIn("id", cat)
            self.assertIn("name", cat)
            self.assertIn("kannada", cat)
            self.assertIn("phraseCount", cat)
            self.assertGreaterEqual(cat["phraseCount"], 0)

    def test_get_all_phrases(self):
        """Test retrieving all verified phrases."""
        response = self.client.get("/api/phrases")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("phrases", data)
        self.assertGreater(data["count"], 0)
        first = data["phrases"][0]
        self.assertIn("kannada", first)
        self.assertIn("english", first)
        self.assertIn("pronunciation", first)
        self.assertIn("category", first)

    def test_search_phrases_by_english(self):
        """Test backend search logic querying English meaning."""
        response = self.client.get("/api/phrases?q=coffee")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertGreater(data["count"], 0)
        matched = any("coffee" in p["english"].lower() or "coffee" in p["pronunciation"].lower() for p in data["phrases"])
        self.assertTrue(matched)

    def test_search_phrases_by_kannada(self):
        """Test backend search logic querying Kannada script."""
        response = self.client.get("/api/phrases?q=ಬಸ್")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertGreater(data["count"], 0)
        self.assertTrue(any("ಬಸ್" in p["kannada"] for p in data["phrases"]))

    def test_search_phrases_by_pronunciation(self):
        """Test backend search logic querying Romanized phonetic pronunciation."""
        response = self.client.get("/api/phrases?q=majestic")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertGreater(data["count"], 0)

    def test_phrase_selection_by_category(self):
        """Test phrase selection filtered by situational category."""
        response = self.client.get("/api/phrases?category=food")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertGreater(data["count"], 0)
        for p in data["phrases"]:
            self.assertEqual(p["category"], "food")

    def test_phrase_selection_by_id(self):
        """Test selecting a specific phrase by its ID with related phrases."""
        response = self.client.get("/api/phrases/tr_1")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["id"], "tr_1")
        self.assertIn("kannada", data)
        self.assertIn("relatedPhrases", data)
        self.assertIsInstance(data["relatedPhrases"], list)

    def test_phrase_selection_invalid_id(self):
        """Test selecting an invalid phrase ID returns 404."""
        response = self.client.get("/api/phrases/invalid_id_9999")
        self.assertEqual(response.status_code, 404)

    def test_random_phrase_selection(self):
        """Test random phrase selection endpoint."""
        response = self.client.get("/api/phrases/random?count=3")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["count"], 3)
        self.assertEqual(len(data["selected"]), 3)

    def test_daily_phrase_selection(self):
        """Test Phrase of the Day deterministic selection."""
        response = self.client.get("/api/phrases/daily")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("date", data)
        self.assertIn("phrase", data)
        self.assertIn("kannada", data["phrase"])

    def test_batch_phrase_selection(self):
        """Test batch phrase selection by explicit IDs."""
        response = self.client.get("/api/phrases/selection?ids=tr_1,fd_1")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["count"], 2)
        returned_ids = {p["id"] for p in data["phrases"]}
        self.assertIn("tr_1", returned_ids)
        self.assertIn("fd_1", returned_ids)

    def test_toolkit_endpoints(self):
        """Test auxiliary survival toolkit and situational endpoints."""
        for endpoint in ["/api/dialogues", "/api/quiz", "/api/alphabet", "/api/numbers", "/api/slang", "/api/magic-words", "/api/builder", "/api/visual"]:
            res = self.client.get(endpoint)
            self.assertEqual(res.status_code, 200, f"Endpoint {endpoint} failed")

    def test_visual_cards_content(self):
        """Test visual pictogram cards for non-readers."""
        res = self.client.get("/api/visual")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 10)
        first = data[0]
        self.assertIn("id", first)
        self.assertIn("emoji", first)
        self.assertIn("title", first)
        self.assertIn("audioText", first)
        self.assertIn("english", first)

    def test_practice_prompts(self):
        """Test speech practice prompts retrieval."""
        res = self.client.get("/api/practice/prompts?category=travel")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("prompts", data)
        self.assertGreater(data["count"], 0)

    def test_practice_evaluate(self):
        """Test speech capture evaluation endpoint."""
        payload = {
            "spoken": "ನಮಸ್ಕಾರ",
            "target_kannada": "ನಮಸ್ಕಾರ",
            "target_pronounce": "Namaskara"
        }
        res = self.client.post("/api/practice/evaluate", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["score"], 100)
        self.assertEqual(data["rating"], "excellent")
        self.assertIn("xp_earned", data)

    def test_survival_lifelines(self):
        """Test town survival lifelines and golden rules retrieval."""
        res = self.client.get("/api/survival/lifelines")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("categories", data)
        self.assertIn("goldenRules", data)
        self.assertGreaterEqual(len(data["categories"]), 5)
        self.assertEqual(len(data["goldenRules"]), 5)
        first_cat = data["categories"][0]
        self.assertIn("phrases", first_cat)
        self.assertGreater(len(first_cat["phrases"]), 0)

    def test_survival_autofare(self):
        """Test Karnataka RTO auto fare calculation."""
        res = self.client.get("/api/survival/autofare?km=5.0&night=false")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["fare_inr"], 75)
        self.assertIn("speech_kannada", data)
        self.assertIn("speech_phonetic", data)

        # Test night surcharge (1.5x)
        res_night = self.client.get("/api/survival/autofare?km=5.0&night=true")
        self.assertEqual(res_night.status_code, 200)
        data_night = res_night.get_json()
        self.assertEqual(data_night["fare_inr"], int(round(75 * 1.5)))

if __name__ == "__main__":
    unittest.main()
