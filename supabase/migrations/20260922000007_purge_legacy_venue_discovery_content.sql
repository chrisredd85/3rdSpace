-- D / ledger 162: the reviewed 93 source identities and 20 historical copies.
-- Apply this file AND its ledger entry in ONE caller-owned transaction:
-- psql --single-transaction -v ON_ERROR_STOP=1. Never toggle release controls here.
-- No new schema, function, trigger, privilege, provenance, or approval is created.
-- Hashes cover canonical PostgreSQL JSONB at UTC, excluding only updated_at.
-- No provider values are embedded: the manifest contains identities, hashes,
-- explicit paths and null/empty/operational replacements. Money stays untouched.
SET LOCAL search_path = pg_catalog;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $purge_reviewed_legacy_venue_content$
DECLARE
  -- BEGIN REVIEWED MANIFEST DATA
  v_manifest CONSTANT JSONB := $reviewed_manifest$[
  {
    "table": "agent_runs",
    "id": "190dc499-1234-4480-89c0-e17779c7a564",
    "category": "legacy_google_venue_copy",
    "prehash": "45f0995c3adeca9b9d5d9300e8c5e2a512bfb6b6f66bfe84dcb22d24b4a6e1cd",
    "posthash": "b357218e53ea95d9c9fe0d1906c43ffcde5d84d121dadf74bfa3538c56ba3da7",
    "preserved_hash": "805a07931036a963060715407c6724ef3750f29a429e25f4f863caf5e90a38ff",
    "remove": [["input_payload","candidate_venues","0","venue_name"],["input_payload","candidate_venues","0","city"],["input_payload","candidate_venues","0","state"],["input_payload","candidate_venues","0","venue_type"],["output_payload","ranked_venues","0","venue_name"],["output_payload","ranked_venues","0","fit_score"],["output_payload","ranked_venues","0","pros"],["output_payload","ranked_venues","0","cons"],["output_payload","ranked_venues","0","archetype_reasons"],["output_payload","ranked_venues","0","user_facing_intro"],["output_payload","ranked_venues","0","commercial_model_match"],["output_payload","ranked_venues","0","questions_to_ask_venue"],["output_payload","best_recommendation"],["output_payload","reason_summary"]],
    "set": [{"path":["output_payload","_retention"],"value":{"venue_content_unavailable":true,"unavailable_code":"legacy_discovery_evidence_missing"}}],
    "serialized": [{"path":["messages_payload","1","content"],"remove":[["candidate_venues","0","venue_name"],["candidate_venues","0","city"],["candidate_venues","0","state"],["candidate_venues","0","venue_type"],["candidate_venues","0","deterministic_score"],["candidate_venues","0","score_reasons"]],"set":[]},{"path":["raw_model_output"],"remove":[["ranked_venues","0","venue_name"],["ranked_venues","0","fit_score"],["ranked_venues","0","pros"],["ranked_venues","0","cons"],["ranked_venues","0","archetype_reasons"],["ranked_venues","0","user_facing_intro"],["ranked_venues","0","commercial_model_match"],["ranked_venues","0","questions_to_ask_venue"],["best_recommendation"],["reason_summary"]],"set":[]}]
  },
  {
    "table": "agent_runs",
    "id": "9db860fb-317b-4111-a944-ddcab6da2b93",
    "category": "legacy_google_venue_copy",
    "prehash": "d220b8d6419903e63671930d687238c89735a417b89a9478da026553700ddc6a",
    "posthash": "69f18a9cbf5b219283904ec74df0d1e01121f13ccae26e0e20780a8d3cbb5f66",
    "preserved_hash": "e6b3dd4e826c92c60ff43c8bf3d089a9240128189ea0dd323eb5b4b13deca014",
    "remove": [["input_payload","candidate_venues","0","venue_name"],["input_payload","candidate_venues","0","city"],["input_payload","candidate_venues","0","state"],["input_payload","candidate_venues","0","venue_type"],["output_payload","ranked_venues","0","venue_name"],["output_payload","ranked_venues","0","fit_score"],["output_payload","ranked_venues","0","pros"],["output_payload","ranked_venues","0","cons"],["output_payload","ranked_venues","0","archetype_reasons"],["output_payload","ranked_venues","0","user_facing_intro"],["output_payload","ranked_venues","0","commercial_model_match"],["output_payload","ranked_venues","0","questions_to_ask_venue"],["output_payload","best_recommendation"],["output_payload","reason_summary"]],
    "set": [{"path":["output_payload","_retention"],"value":{"venue_content_unavailable":true,"unavailable_code":"legacy_discovery_evidence_missing"}}],
    "serialized": [{"path":["messages_payload","1","content"],"remove":[["candidate_venues","0","venue_name"],["candidate_venues","0","city"],["candidate_venues","0","state"],["candidate_venues","0","venue_type"],["candidate_venues","0","deterministic_score"],["candidate_venues","0","score_reasons"]],"set":[]},{"path":["raw_model_output"],"remove":[["ranked_venues","0","venue_name"],["ranked_venues","0","fit_score"],["ranked_venues","0","pros"],["ranked_venues","0","cons"],["ranked_venues","0","archetype_reasons"],["ranked_venues","0","user_facing_intro"],["ranked_venues","0","commercial_model_match"],["ranked_venues","0","questions_to_ask_venue"],["best_recommendation"],["reason_summary"]],"set":[]}]
  },
  {
    "table": "agent_runs",
    "id": "b8bc31e3-37f0-41ec-a9d2-36eabbad9d32",
    "category": "legacy_google_venue_copy",
    "prehash": "09a1d30755bc727bab074fc2b4aaca2b321121ec0adeb18eb3f907f2e7fbfa6a",
    "posthash": "fe05a58412b17b018eeed726af856f3b947f92f60c3eb04525c5540e1172014d",
    "preserved_hash": "9594b50393355dab0f4a7c47f1abf1a685383c708a20b6021d6e261807e72e9c",
    "remove": [["input_payload","candidate_venues","0","venue_name"],["input_payload","candidate_venues","0","city"],["input_payload","candidate_venues","0","state"],["input_payload","candidate_venues","0","venue_type"],["output_payload","ranked_venues","0","venue_name"],["output_payload","ranked_venues","0","fit_score"],["output_payload","ranked_venues","0","pros"],["output_payload","ranked_venues","0","cons"],["output_payload","ranked_venues","0","archetype_reasons"],["output_payload","ranked_venues","0","user_facing_intro"],["output_payload","ranked_venues","0","commercial_model_match"],["output_payload","ranked_venues","0","questions_to_ask_venue"],["output_payload","best_recommendation"],["output_payload","reason_summary"]],
    "set": [{"path":["output_payload","_retention"],"value":{"venue_content_unavailable":true,"unavailable_code":"legacy_discovery_evidence_missing"}}],
    "serialized": [{"path":["messages_payload","1","content"],"remove":[["candidate_venues","0","venue_name"],["candidate_venues","0","city"],["candidate_venues","0","state"],["candidate_venues","0","venue_type"],["candidate_venues","0","deterministic_score"],["candidate_venues","0","score_reasons"]],"set":[]},{"path":["raw_model_output"],"remove":[["ranked_venues","0","venue_name"],["ranked_venues","0","fit_score"],["ranked_venues","0","pros"],["ranked_venues","0","cons"],["ranked_venues","0","archetype_reasons"],["ranked_venues","0","user_facing_intro"],["ranked_venues","0","commercial_model_match"],["ranked_venues","0","questions_to_ask_venue"],["best_recommendation"],["reason_summary"]],"set":[]}]
  },
  {
    "table": "discovery_venues",
    "id": "0419d7e9-ca41-4532-a91c-5fe9a3e5055c",
    "category": "manual_seed_with_google_fields",
    "prehash": "e62fea2a05925e7947afa838d265194ec8f3c54564fb644c57faa10f1ece5f37",
    "posthash": "a259a1a47cfe81b6bdbf5c9f48ce2fceaa102b0da3c0ec76c33c0a6ff88e375e",
    "preserved_hash": "fe4b0a70c9bf8dc221b7ddf07da65104889bc031102bc8441656821bd8fdcf3b",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","4","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "04d6d9b9-a6b3-458d-a69a-44a6ea8b78eb",
    "category": "google_discovered",
    "prehash": "fa90c92097d2de3fd0d791a7742ff7aa5a989b4a836b14cc7a71394e73386d21",
    "posthash": "4644ed5acb93a4b4fdde1d862d2f78a16278ad1c721d93d376c916f61c201b26",
    "preserved_hash": "295a3045b6492b1e047d63ce5f68b2010ce0fd62c3e5bd363943d31114242485",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "0758432b-cbf5-45d6-8685-4583432bde7b",
    "category": "manual_seed_with_google_fields",
    "prehash": "d9fd5dc425bf0c420fbd84092e308b07c8648d304c4616e353dc3d22dbb89f43",
    "posthash": "4dfc3c45702e85530b08f4bc2a34b245b74feb688f04afc66308db183515b815",
    "preserved_hash": "d9f145ed5ba4892634dd169dd491bed103685042e8a85890d675d9f631885254",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "08226142-cde4-473a-a649-a9637d50d23a",
    "category": "manual_seed_with_google_fields",
    "prehash": "7f4257cf2deb1d1657a27a01142119eb4ec0ba46217af098b421b5f73f424b51",
    "posthash": "79db47f5a9832fdb5fa8e26f69e3d80db14fa99e3fbe804c6b1955de949371f8",
    "preserved_hash": "db5e032a8eb5dbfe3ee598e8f2d68e1f0160b4ecf29e14edbaa44d7c3db0d718",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "0ae30f0e-eb2e-4c4e-9997-329fd9c5558e",
    "category": "manual_seed_with_google_fields",
    "prehash": "6b1383bbc157c834efcc58eb575211227637f54d44ae2fb04123cbbbd2bacf6c",
    "posthash": "bf4cf3d3cd207d5d572ec0c93b24824dc95093fc9e0eca462dea3ccd025fafdb",
    "preserved_hash": "cfb43a486fdc1ac8658c5679e2186547ac3d9cd081fafdbdf8733de81e182c47",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "11cfe693-5d57-4900-829c-7859f843232a",
    "category": "manual_seed_with_google_fields",
    "prehash": "1168fb7b2037d3958fd2f6f23ed97ec756829eeab0d3a31f5ae3e0be1a4c0acc",
    "posthash": "ac44fd4872a383be9e506bc018ec5a36158dddbea933ab6add63e687bdd61c25",
    "preserved_hash": "0db3d16e109bd1cd0f2b6c1ebdf313c8f5fc8d689a16f3483181f5ad3308df8e",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "11f0b39d-2690-40ef-8f38-44db4e2a5964",
    "category": "manual_seed_with_google_fields",
    "prehash": "2c951a5f4608f6be11bc9d2dc8326849c90f8010281b2da310aff3d74e816071",
    "posthash": "47700a1281d17bb981bb728d4258d780816a1de667a25ed9043e7b2a3c88b7c2",
    "preserved_hash": "8a693660361e772011305c75fc1b20697a1130dbe59ced5b6de389f851e9b219",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "132c2552-6e10-4c6c-9334-18c30937152d",
    "category": "manual_seed_with_google_fields",
    "prehash": "1ea18ea8adbccc295b83511fd002913c2f4042d1a51056b1e69166e32682280c",
    "posthash": "02782e1be7347a55e9a0a1e6cda66ecddb66d59d6ee12b324bd2555906093db6",
    "preserved_hash": "b523d743fb5aba3ec53e3cd56605afbc7550ce72da9127d6e59e41306cde98de",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","5","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "142e6585-726e-486d-b426-9477ba82e511",
    "category": "manual_seed_with_google_fields",
    "prehash": "c2178ab11f099028d3a9bd9c886460fe8b3315d4c93e97a48d86f77c1b64131b",
    "posthash": "7d6bd17f9ee74b4476daa0a7bf3b20ca0556c589003e30db61c00cc8bdac0008",
    "preserved_hash": "6e4632e214629dd1c901fea3facfa45d9ab4cd3935cdc9ff9c5d646c6bb3224f",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "1b9b64e3-bfa0-4b44-8212-f46268a46023",
    "category": "manual_seed_with_google_fields",
    "prehash": "abe927b5ac8c5aa7ec45450f9d0cbb232cc5bab653872af1ce0b2845b3b1ce8e",
    "posthash": "1efc93aa14e783ea02aab632291b08e23ac3674dc003ad3d4e70639dc70eb45b",
    "preserved_hash": "82db4f246a67d8ad4dd756e1bf25dd4cd430c7975ca34990d14854546775dc01",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "1c4602dc-0b39-4417-9677-751d4bc1f758",
    "category": "manual_seed_with_google_fields",
    "prehash": "ee2670d1b3e9216e625674cc4da64600b6925fec2d1a5a223bfad1605db4a680",
    "posthash": "03f268ecf35a75c14709162a103d55f3681f99bd3863397b3dceefeef2d4383c",
    "preserved_hash": "e86a2728ea93721356e97a6b6b9e9331efb9000fadb11446e182757e54bb65c5",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "275db92e-898c-40a1-abde-7470320ad035",
    "category": "manual_seed_with_google_fields",
    "prehash": "7a7902d351e659bc69c755b8f90d65aaf6c96f06d9e4b1109a42ed5dba11c430",
    "posthash": "bffdc8532d0f7e21c20640d9e73e6a4f79f534310634e4bee43d2a036fc9a996",
    "preserved_hash": "79b4fd56dda565382aea06a142541ec189bc4fa94723fa816cd69225806e9da0",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "2a7d2f99-0a87-4470-b758-d7abc33e5003",
    "category": "manual_seed_with_google_fields",
    "prehash": "6fdec8c0e2739630020b1df18760220f8085982f84074b8b4a8d41a315cf0948",
    "posthash": "5a5779533cf9070c2c6bd560a9f24c346e594dbac7f40e21c263b723a1ed6366",
    "preserved_hash": "3779617ab2f27c5383835c1f1c1740d328a2bf8c83b1375845be453c17968ca7",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "2b8954bf-bc01-49f6-b8d9-4a9b8fb21cb8",
    "category": "google_discovered",
    "prehash": "4f450764500772bde7f8c364a753cc966f7324f06b3ccccfead7fa29ccd29d31",
    "posthash": "7591aa709ff0b281c5e2c5b8f52d924fa91fcab985a6d3fe6fcf7e9b3b0d8660",
    "preserved_hash": "f0c509c3806bac925af5ecd9edeb00eb18f60f6a789f922af2035e5bfb59269a",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "2c3ded17-c9ec-438e-a8a9-571aaf5800e4",
    "category": "unresolved_manual_seed",
    "prehash": "00eb7eb54851bd3523e0b7e2546fd4ed1170024ed8ab6b0ee6db3ecda84fa983",
    "posthash": "3317335ecd9318b3cdc8fb4ccc0061d0ddd556270666fb6ff39348340d5ba4d5",
    "preserved_hash": "8dfffe74a59560146704d959330ba7810d72e5d2b2c9f6556726cb77dcd9e902",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","2","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "31afdf1a-6113-4b97-b374-a682e0abfd84",
    "category": "manual_seed_with_google_fields",
    "prehash": "2ee05e6a2025c451f0849a94f5fe3b354aa2940aeeef832994d4e1494de0474a",
    "posthash": "6f3ec27edf1263f73b907c48ba1ccd1c680eba83fba90d860593f16ac2dca9e9",
    "preserved_hash": "3a0067e4df02c36f5024daf19c7183840d72ee2c1b48606545e07a63102f564f",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "359cef8f-099a-4fc3-a512-a0ce3d90c168",
    "category": "manual_seed_with_google_fields",
    "prehash": "f2ba0b3793534fbd8df743c05951d8e029d197454f895592df98dec696a2ae07",
    "posthash": "2db7dd4eacfce7536a599cd61c2496e0edb6b563f72e3db2140fc841cb803531",
    "preserved_hash": "a1a74a8005dce99c8d679dd6da5f3ee24118a96b904d008a5f98d5c50aaea0b4",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "35fc47cb-d3fe-414c-9400-ea5638824e4e",
    "category": "manual_seed_with_google_fields",
    "prehash": "63faa4eaac3c68d4b7a825124caab2cccc68cf898ed1e35911a8f6fbf96688c6",
    "posthash": "0edc9ee1bc326bbf5dcf0eb2e09e79623ce42770b03ccd23123699ce09938594",
    "preserved_hash": "6772039446562127129f91a32f4d4f9098726adc58ade6d1701703d6883fd160",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "3a475dc8-04d5-4ff5-be01-4d007d6d4d7c",
    "category": "google_discovered",
    "prehash": "d0659eea894bf84fe0035ac8a86a4ecb55294732d5bf8191239e2b7574425852",
    "posthash": "354b21d0888d2af99077c71645edb8d864222caa1b51ff6237e296558be564ae",
    "preserved_hash": "99683992f3664f60a9f5918a27b1e1dd3a43016e84649fc4fb8de00b7b02ad7f",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "3ae99ac2-89f9-4bfb-9560-c7b001f0946e",
    "category": "manual_seed_with_google_fields",
    "prehash": "f8f2583f8e2c9f6dc4c9e37978461f0e2fb4ade9be60d2913bf1c79324058670",
    "posthash": "b2f634655d95a8d213a32a4bc140b821a5c83f7a7db6d56d917f5ccaf5e1342a",
    "preserved_hash": "589353dd13bdfa24d80fe692e2440e42bf9821a6ad7a5d4d12bca68129d8f75e",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "3c580c54-db19-472f-a98f-eefa1858351f",
    "category": "manual_seed_with_google_fields",
    "prehash": "371376dc7721420d23a047a9fdc2640944b133c10597453fc13898b2bf6f0c53",
    "posthash": "25336f53d44e706d94f45b1efcb6aff7f5ce077a388ff5445f629d509bccfa45",
    "preserved_hash": "cc0f5a2a692933bff7d0b3b4f68b15f8b4ce126b0235bb51415cb80c2d3c70da",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "3cec35c4-8832-4ca1-afba-a81510808859",
    "category": "manual_seed_with_google_fields",
    "prehash": "c4dc185b89f282f5c4a715d33ebce7fe6e3e6b2bf985c56676c0c62210b3891a",
    "posthash": "064e6080f6a504f7d85dbacf508405c1841e3b47c1f0ec7ffcdf77c247a11ceb",
    "preserved_hash": "77d0d34e604b07c445c98dcc59d63345c8b5021144e0653d9912156e4a8e1bf2",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "3d458875-2497-4269-b8ad-ba7a2f70d9f1",
    "category": "manual_seed_with_google_fields",
    "prehash": "345b380b2f0399b5c4602dcc86f2142901a25f6d927323d0539045b73b3990ec",
    "posthash": "de828fc522b061b5606142434f9e35548066ec3d2751a5b2dbce67fd173496bb",
    "preserved_hash": "25c8dafecfce74df464bdc490ff90d82ea31cbe9fc2b180062e25cc71292c499",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "3eacd03e-eaed-4057-92f6-904375b074e8",
    "category": "manual_seed_with_google_fields",
    "prehash": "eaac917d2e8be6223ee2c9377b08f9d2cfff6cd3d691d2498887f13e7c50e53c",
    "posthash": "a94c661d9a4be6948e137f31144c457bce46f4f8a9b49f92c32b562242ed71a0",
    "preserved_hash": "e5f91a11a9e4e8a2237466eb631fe629f4e2e59ba7382272a1e1ac37be4bf697",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "4057db1a-8692-42e3-abbd-5aaf14f1d38c",
    "category": "manual_seed_with_google_fields",
    "prehash": "aac3e42959e3d99becb19cb1869a14004e6887fc1b0cd74f2e64ae0c920a49fa",
    "posthash": "c815ec76c945645bb6c1a69aa2f0ceb47ca14aa90f8e4c204073251cd9f4ccae",
    "preserved_hash": "ff3a817f980793c6107e8ef6ba20b613f75aa103fc6154a037a456de2e006e67",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "42684342-736b-4ac4-affd-986902bbdf7f",
    "category": "manual_seed_with_google_fields",
    "prehash": "3bc03b2c1fea46119c0dc1e62a5b4abd853f473ed4a936b95225401dadc46c3a",
    "posthash": "609a90061df1b9627ff39ee39d1085a533b4e11a887e5e81571c42253cf3048c",
    "preserved_hash": "04403471f796e4be4520587fc567a6531844dfe3b7652f523e26268ca04a750e",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "439a2222-9eff-4c89-9ac3-0f1c22dd4822",
    "category": "google_discovered",
    "prehash": "046e45150113ed1df5455608a792d0bdc21250fb6618016e802e58f64362b561",
    "posthash": "141dc31076e8d946315bb9239beb6003c2982f30ec2762c65ec1f931a97e6b1c",
    "preserved_hash": "b3248ee8bc8f9b7830fc513fb5088b4fb80c9ef57bb6f154e1eed85fe545dad5",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "4533b0e8-93f2-4b98-9b5d-b287395ff172",
    "category": "manual_seed_with_google_fields",
    "prehash": "0b9e32f376d80d2e8b87f5089d2a16fe8445bf7285920e9b5e502f2baf9915f7",
    "posthash": "75bc148cf081ed4aa4046dbd0f042655bc50314ccb2b448fa61842307834627e",
    "preserved_hash": "1e843fe12d2f27d93415def32310b9de2946a822db219b9524937a38ae083df9",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "46054e4a-bb0d-48ad-be81-4ff184bd8623",
    "category": "manual_seed_with_google_fields",
    "prehash": "c87b9c7aefeb0def77de21299f5eba2645f84d8cff76c1045372c219050f318e",
    "posthash": "58720ef7dbde7ec1ca17a7ef71562cca530c5016e9a2490ee1ffabe373ca998e",
    "preserved_hash": "89f9e5bec82cc15ac3a1e072644f09fbeed227becca5648c65acce20220c9359",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "49ffdca9-574e-437d-ac3b-d59f82ca9df7",
    "category": "manual_seed_with_google_fields",
    "prehash": "9a2e392938727b199930b3af84aed31997d488988be3079363f7fc42f65f75f3",
    "posthash": "5951a8d822989baaa9990f8df212e52c2bd220b5e31932dc575afbdeacf813db",
    "preserved_hash": "6fc9167255cc647c8065ce1c8cf59f4d4b990068b51b6ca20d29e6b0e77f634b",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "4c312bc9-830a-498e-b03e-a12b6ea3b4f6",
    "category": "google_discovered",
    "prehash": "5f0f54401f13ce3a3113864cbd0d15db50df35fbf7fe5142aaeff5eae2b19457",
    "posthash": "93120ff7488f437edbb477f3287b78ad688a14681cb885c6940923ee2fb6f935",
    "preserved_hash": "0b431ff1bbb50d06be52595956e891f931bea8f98b52a14c8802607b0f5cf9f1",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "4d745ce3-9e6c-4071-96c9-94d13f3aa902",
    "category": "google_discovered",
    "prehash": "6d38e5c1e5077dd701bb2f985e5bf41b52a294beaf9f234ae7e457627facce4f",
    "posthash": "a4b2cc1a73d5b42016c413610edc127fe945eb51e55e2a5d41613c35172311bb",
    "preserved_hash": "9e7f661a47f12d53c958b410d11300789a472678df763e7769ed87e69dd20df8",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "4d8455cf-f0fc-41aa-8b5a-c8907fb815ed",
    "category": "unresolved_manual_seed",
    "prehash": "388ae8e3c877321a36cc1c7ad78e9b9743a05faddf7d9f6e86349195c0db03aa",
    "posthash": "0771ccee1d348ba45afca91d98a79b3c689fe7e6302b0f9395e4176b359dfdac",
    "preserved_hash": "5ab37ff9a3598b3b60f92f3e8c937a83fb0233b0fd8b7bd0c0eb1bbe44407f7b",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "522eb319-e1eb-4f85-9f24-2828d9058aae",
    "category": "manual_seed_with_google_fields",
    "prehash": "f387e0ed62a0c04f988e5d389e670eed3263cfcb6a7cba6a31dedde8d438c922",
    "posthash": "952a3b0176999bc46e5d01e27f4e65efdfbfe70209461e6704412b4b8089ffca",
    "preserved_hash": "976ab2df9c7b37c7c90157307266d0e1ab0733f25b398a66eb318a0d81e29302",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "554b34bc-2fe7-4a1d-93a2-d813146430fa",
    "category": "unresolved_manual_seed",
    "prehash": "399c6f7af1163fde57d833d3e6e76d26941995e7ccd86dd721a2c239d00f4751",
    "posthash": "141d8829fec7319d663e798281fea1d631ad6f4e41d6c269636ff7d678bd6461",
    "preserved_hash": "500936d1b3bcc3412190342ec19ced29c926e008300e2944b0ee16d713937861",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "5be2d28a-c00d-4623-ac51-521bdaf19bdb",
    "category": "manual_seed_with_google_fields",
    "prehash": "c95ac17b66cfe23d32c14940caeb17582c056cc53ea3d1f78b2088ee1de564ef",
    "posthash": "79fc25f3233467e36ce68e39c6ac653b404981d7905b2b74463e9cc5b0e6e148",
    "preserved_hash": "9ac8b0eef26fd33aa7bde60fb362149f39be92d46badc1ca37780c8147fc28dd",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "5cb5d598-ebed-43af-afd8-6ec20ac95487",
    "category": "manual_seed_with_google_fields",
    "prehash": "93e6843fc7c5169d08e2824952f193adbf072c3c2c1609f47d4923e2f3e58416",
    "posthash": "a129b360cbf1ce79cb210834ca85a0cbcd35335340f5582a5785f4526c869897",
    "preserved_hash": "22854e7eef1f1b6e1d050544cb6182d39ae4a50e6b212ace31fa82fc19128c7a",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","4","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "5e4a4c3a-a194-42d1-af48-3a2987d18f11",
    "category": "manual_seed_with_google_fields",
    "prehash": "4ec0d19ac16fff94b0421b7ab1cc55678214b7d251a6398fc34fdd824e85dbb8",
    "posthash": "4546f7124b520743d888b02d82233a641aa33cb8045cc5816b4b76c0aed256ef",
    "preserved_hash": "f3e0e6fc33b8e4dd2988ee2619f8dc419c1a2c1ec05dfa96f1f59c10754f1161",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "5f4b5bbb-0b00-48d0-a652-53687c23a482",
    "category": "manual_seed_with_google_fields",
    "prehash": "b4d707f7429f789a1a1bddbc9cab0dd80ee0f262cb3c8be807b66363f6ab20b0",
    "posthash": "18ca176b87d413b0c999de82b9a390bd3e7702339d3b9cf19ff39b83e72b8970",
    "preserved_hash": "375493c6614f417e90478d29ede94504f360fcb3f7f91712d62812cc34c410c7",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "5fbc7ee0-2d69-4ae8-a1eb-5afb713d6703",
    "category": "manual_seed_with_google_fields",
    "prehash": "2a2baf313fcc810d8cf9a49d764e1cc9193b3fcd66b886e388002990cae9223b",
    "posthash": "93157d772379c8047c4d6bad93edab297f5031b51a522aad1086316fa0094492",
    "preserved_hash": "d197355be4d4746bdd6bbd9427e15ef121a83f17bb4e2f30df4793ee91dce8fe",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "641d873e-0b14-426b-81a7-255ae5b40c75",
    "category": "manual_seed_with_google_fields",
    "prehash": "0a991dca9f79910e1fe466528ed28535a6e13cb56ae3ec0eeb53f1805137edfb",
    "posthash": "74b05c73b21c4b203895ad2e250ce2047544fba4915a1e1f97ce147e9eb557a8",
    "preserved_hash": "a3c7aa7188f9536ab835f68456283eb1c1ddf4f9e46f2b738cbdfe1051eae59d",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "64c36586-80da-4397-8a9f-1220d31b297e",
    "category": "manual_seed_with_google_fields",
    "prehash": "e19262bdfd6c7fa113fbe7ddba76c187ac9a62f9d7514081331fcedcbf588d8f",
    "posthash": "50e98a2dcff40438c865c380f827ca7f5ed89ec23d6d67c9c9a8a79150f706c5",
    "preserved_hash": "b61ce95044d769f8d550617df279422193c47114d193b412c97d4aaa3f94a83a",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "673890c4-f14b-4d5c-99a4-4a3902d2aa32",
    "category": "manual_seed_with_google_fields",
    "prehash": "3b662c254efa4e486b30eb879851e401a2113b91f82ac14627e3a05e501d0d8e",
    "posthash": "7366a2d85776fe5565239ce6dd7d8d7c989395ceaa883d8c5371e9c7741d16f0",
    "preserved_hash": "108026d938bbe7478ce15f994c7ae366e583fd6dd66ee92ae794aa58e49254c4",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "6914169d-3adf-4f6c-91c9-c9bbc0cb3fe6",
    "category": "manual_seed_with_google_fields",
    "prehash": "95c70f26cd04aeacebb905a07782264c03c09392af21d54313476513f191e6c2",
    "posthash": "144027ab6d23811312761b49dee165e79709241c9abd53044d5aba37d2d83e30",
    "preserved_hash": "767a248f9455cad66b573db0a310f979690dc8093492ea406a244e94f87dd02b",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "6a3aeeeb-02b7-4954-b62d-5ba93b37824c",
    "category": "unresolved_manual_seed",
    "prehash": "64d52715693dfea120c1d90803b5e01616bdcb31280a0d82f3bc6dad71741c5b",
    "posthash": "3840c2464e4798c19ede315c05852ab3f9f16fc9a915cbdf54f54f8a6237f391",
    "preserved_hash": "c6aa8c0905db0adb81ea103f38e00ae23d9c91b7cabfe0b91e6571058068d3d8",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "6d8add4e-48bb-4b36-9350-e5f2a19b5954",
    "category": "unresolved_manual_seed",
    "prehash": "6da9e229349c4c4d7e0ea829093012387ef2ebfee4cbe4da20a3c9db65e8e18b",
    "posthash": "13cc828179ab658b77e4fecb97df920f46ffe7c920c8d899aaf3eba69436bb75",
    "preserved_hash": "8843e99a6a54ade24380aaea3c5ce57c6dba7e3f687bffcca86e62f021d17cf2",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "70c08953-8056-4d06-89da-c7b3c0d8d2b9",
    "category": "manual_seed_with_google_fields",
    "prehash": "4bfd03912feba3967e6324492d5aef65ca5a12020511dbd3c09b8de951083130",
    "posthash": "e427aabf286de0fde7353f6b3962b990bfac5782ad6e76ec6c9fbc37dddbfb23",
    "preserved_hash": "ad72161dcf6991383708235a32578d57777ace11dbb58efc27f23c87d6389805",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "71ceaf3a-a4aa-4709-8874-e00a02dd235c",
    "category": "manual_seed_with_google_fields",
    "prehash": "da1cccad64ae6622dee6ca4d5a907d0979202ab706e5b6d8a855de847964b4f7",
    "posthash": "2a8187802d40527f76c3c2ecb6b7818881add751b418fb3e37c6ac4aec5911ca",
    "preserved_hash": "3a544d4861939bc7a7bf70afb5d366211ebda5f51e3d8f4f5d07468036a86294",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","9","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "7253591a-370c-428d-9ff9-fae0bfe4da1e",
    "category": "manual_seed_with_google_fields",
    "prehash": "5217bd58bcf03251a96dfa546ace8da71af7f12c046632de63bc872ad31dfbc3",
    "posthash": "30dc41e59a167f78dd9632da76f2085866c5c855de9f96d93b312c782d7a3a4d",
    "preserved_hash": "5c08e3345acc16ae0d74598a20300524355dd3652cfc22ba0664e28935614f6b",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "76c31d46-f55b-4f75-a771-7d2230e1deec",
    "category": "unresolved_manual_seed",
    "prehash": "f80ebbbddd4d7cc817b883a446c765b0c46753ae223eed4fd883085ddf2c86b8",
    "posthash": "3a370f9e3d45074925528fe9d6a4836a99223e94b3511627460dd8003288a8be",
    "preserved_hash": "212c91fb851bca691c9d855650ac59fbc5c510772ed9750d226ffa5187027e8c",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "79b05a0f-96c0-40bd-b0c4-df875a7f6181",
    "category": "manual_seed_with_google_fields",
    "prehash": "cff30ad64f394335738213092000a79aa1c9688c92675e01c83f33b1c719c1b9",
    "posthash": "771bdb754845e3ae9a4e5c5e5a4a1c5a64432b7e35e0aaa545e663e880d8cdd3",
    "preserved_hash": "3981bc954d660aca508486caa8f86552c6a23fa9098d60428d61d2bebf2d5523",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "7a8cb6ac-4435-4ec4-9be3-a2143fc3da14",
    "category": "manual_seed_with_google_fields",
    "prehash": "ca0af4740e27f7d4b79f625b8d98e29c4ded6b2c1685c0722de84febc47648d2",
    "posthash": "b8f9caa14e5f59c916d244e39d3515fccc9162d5dad36e6dd4b96e8095b1f88b",
    "preserved_hash": "45f293ee598790f0368b77b7335d52563ef1846fff09cea5a838ffb8e8e3b658",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "7b7bdb67-4a3a-4bf0-b8a2-fdc2f578d2b1",
    "category": "manual_seed_with_google_fields",
    "prehash": "44ed7b3e0df36e8963bf8bddfea9340641a93b71ee2dbe2a3b6c1fe2127996de",
    "posthash": "e47c9242277ed215df7c4122bccd8f37a65be5f6c6d1fd90f83a25e024ede901",
    "preserved_hash": "3f815105cdfeb6c4345c46c6e3a665cc5e851f7ec414657916b6bf9e6674af39",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "7ee99056-5a2b-43ef-a3a0-6b1cb07048d6",
    "category": "manual_seed_with_google_fields",
    "prehash": "9e2de340c8aecdfa00d3185f049f2c42eaa06880cb7d239ff0a6200fddace194",
    "posthash": "19a3f77d27e2fd51f1d2a20393308e81e92570c6b0ce8271bcd986d5ed9e77cd",
    "preserved_hash": "a9014b596b3690978d4a11bc5d32ab66c52d792144d0af38ab6be01adfadc049",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "809b5568-8f6c-480e-b58f-569025839dd0",
    "category": "manual_seed_with_google_fields",
    "prehash": "a6a49371d9ff9f15e8545475e644782e6e3c8db8690821ee4b7b681ab62615c9",
    "posthash": "2db0396d613b1b355cf570263802bcc4f8397dc111cafdd7acd4b36c8e71fd01",
    "preserved_hash": "47b39ac51800b9a22104e8c018d0f5aba45775981ad11b1ef0650aa1e1822e0c",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "85d76ff3-8c36-4a5a-b1c4-37514f4791ad",
    "category": "manual_seed_with_google_fields",
    "prehash": "c4184ba394cc1f5e623abeab2ed957d375953c71eb1c991f2b222c78060122b0",
    "posthash": "2ece66062688eab97ec9011cc5424203056ce142adde95bd5fb15c9785542d6c",
    "preserved_hash": "ae360714603bcf158ee3f64b862a0e17b210f223ed06dbbba6807997a9facd2a",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "8736e102-cff7-4cc2-abf7-20f5913759a4",
    "category": "google_discovered",
    "prehash": "302f339d938427306f940a938aef0cd434518715acf21610dadf311396a61f64",
    "posthash": "eb903d0474df8776c3ab5d878890946c948c2b8bfef828f595ac2ce4e048e382",
    "preserved_hash": "e18e16021b9bfec38451bb1f4a0e9da4bf4bd35739d4f43f160e1717aaa52ed5",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "8932e77d-491f-4feb-a51a-393878241741",
    "category": "manual_seed_with_google_fields",
    "prehash": "6ec34cc5a34520bf1ab18725f79a634bcc9f9a45dce4bb11ed8d78c24681fccc",
    "posthash": "08e8f0d0be4b510398793ce591366accf8df0972cd5a6f2bcd27e30aa865b0d0",
    "preserved_hash": "167f542dc32834810246ac7122c3cf6c9a310fc7d00abeb5a4c6784732f08968",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "8ba5a48e-00c0-4fb0-8017-f9b390fec927",
    "category": "manual_seed_with_google_fields",
    "prehash": "2c0ae2180bfd9d7fde7d4122c96a02814df84829cda5050c2f7c484bc4f73f3c",
    "posthash": "d9afa04d0d866fedd38598f694e224b43d71ecbbeac2becf07d26c46a2b3b505",
    "preserved_hash": "10eb4ffd743e68b54bfe00647d81b24d9396bba73209d83abf285215d68b08fc",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "a23db3c2-1a2e-4f43-b536-f27c67881bd5",
    "category": "manual_seed_with_google_fields",
    "prehash": "fde49001f3e3f5123ee39977ad423d3e596171afa46d56dc16375e1d8e3ad142",
    "posthash": "7e18284e16d0e8889eb19b8b016ccfd4f96e8b643f7e0ce497b50ae59cbd7877",
    "preserved_hash": "6f6558ea955ee0a4c7666b210d8b16758c7b1fff46cec7531cfe4b41b01b84e3",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "a2ade6f7-103d-43dc-a389-0fb8e4b646c3",
    "category": "manual_seed_with_google_fields",
    "prehash": "5ebcda29bcac107d14cfe385a22c136c49e7f5f186677be11d9059fbb03de4f9",
    "posthash": "337d90f28d15e0aebed360e2a921128a28079d6bce9fe8f5d65d424b8bb4a40a",
    "preserved_hash": "2704d0232cc6ef71c4eceedbabe8eacbd8d4e0bb2b7eaf2786fa82faab5e3d45",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "a6898ceb-56b9-4f06-ad13-342f1b0e42b8",
    "category": "unresolved_manual_seed",
    "prehash": "d699f429f0114a7abbff0cbd25e6a8ce9d1671fbb0ec7a059719de27d61faef2",
    "posthash": "58b4c30e187a873cb17f63f479c3caa8541ff260babc0e1c3165f692ff1b60c7",
    "preserved_hash": "d3ec0282ff292ed9ec80a5285ec9ca6f091a4479421ecddc45124c701bfa68d7",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "a9e9169a-e3b2-421a-b492-b646a56d0d09",
    "category": "manual_seed_with_google_fields",
    "prehash": "ff3bead8539340ec67160a3b677e75d4a08780281de4bf7be74b16bd43521f74",
    "posthash": "7355078ff95b94e72356b9d233051d81eb3a997fc79d455e63a9b516f2a8d552",
    "preserved_hash": "f9779c6ab05b781105c70e3e40b7cea1938a11cf78aae915d17734a8a74c99dc",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "addaa98e-4cd1-49cf-9c4b-9213a27e34e6",
    "category": "manual_seed_with_google_fields",
    "prehash": "3e70c6332a9123d853d462939bc23f01ee8fd0211dcc37a88c2ac8ef959b0d3c",
    "posthash": "cea64ecc6b02c645ca8d775e41c9a4c0e55f63c6777954be11d7bf4d46262e4f",
    "preserved_hash": "2d8e4bd62c530258daaceb5021e40ac9dddc55c4f691634564d07974b7398585",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "b0f1580d-b999-408d-9a6c-281fb7d67148",
    "category": "manual_seed_with_google_fields",
    "prehash": "21050c45885e4406b811127a5f17ab9099f436070b6a9628fd177780973c63d6",
    "posthash": "7a4100adfe2755516e0f43973b796698614b475327fb7d86f734ff532dd3ccb7",
    "preserved_hash": "04e7544fb3d1d23e3d5ebd8f6eb2c98eb1030d04d33a7b65d705b31ebe5685ec",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "b6feb26d-ca6f-4f04-9811-dc5de2956fdc",
    "category": "manual_seed_with_google_fields",
    "prehash": "adeff12976586243dabcbf5911b093e9443a0b73fa0d063492c914c49cf041af",
    "posthash": "c58f5d135aad6a19bab02ad7599913392ab5082eeeef426cd8b712768a0583f2",
    "preserved_hash": "b6020e27e6306a62cd1397e5ac030c413be8424477b9bb25b819b9f4dca19211",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","2","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "b81d16d2-749a-4a5b-bf67-bc39a661d230",
    "category": "manual_seed_with_google_fields",
    "prehash": "63ee4986987284ca4b9aa6aad9a3e034872533601f1fa6e7c78c1516ef17f2a0",
    "posthash": "87e304e54fe06b73aadf8c56aa1fa86c379e996c49d89253426fb58766807caa",
    "preserved_hash": "693c3dfe77a4feb7dc2992e0e4623212c9d1e1262a6756029dbf0f21a873f097",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "be3e5079-6059-40fc-80d9-eb36db61eda7",
    "category": "manual_seed_with_google_fields",
    "prehash": "efb74c5a146cd7a063ce13be5ce20546101a75b0c3d514443fee7cbe027d15a8",
    "posthash": "260c641efb292a3b646583c2a2f55ae980360dc5cfc9617f371216c515888685",
    "preserved_hash": "38bc76a1e238366877f091903b08c69b0753134fa55495744fb818f6491baf21",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "becb5da1-f467-42f7-afcc-2b9945002d5f",
    "category": "manual_seed_with_google_fields",
    "prehash": "77708c5a8f0e5d7891646cef0b66b4a33cba0165da488e9948aa8c36a8f3229c",
    "posthash": "fea2f0f0be79328e175849d4cc922aa7d983d567426c05939147ce36dfd9a904",
    "preserved_hash": "50cf4e02b850c409e4b995b694a40cf7f0d631dc4e044d38551887b0c2b9bfdd",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "c11a0767-2c6a-4bf0-af70-b786df860827",
    "category": "manual_seed_with_google_fields",
    "prehash": "ee8d994fc7452d3b6445fde97fbcdc1f1b821a740ba9164b81091598f3a57611",
    "posthash": "bbf72c796d67e3266e23aa35de50495edd9dd06d05bf15a62aa450db12e2f95b",
    "preserved_hash": "8001a292615ff825ee9fb3e86ecdf3f794a4dd7a5a5747ad2a386dd0005471ff",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "c22d6400-f59d-4335-915d-fe10d7bec5e8",
    "category": "manual_seed_with_google_fields",
    "prehash": "8f8aacba22c6db9975e4328b7ab7b1348d3a9c738a6464da789d40566368ec95",
    "posthash": "02e61dc0c9ab83693874e28890ea30730d233685124f9e91be3a9c0355eb6b8e",
    "preserved_hash": "5d0084b072614719661d6f86b89c81db68576079bb742b1e196e444251b9ab45",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "c2f70061-9fda-4a99-81f7-f537c45dca5c",
    "category": "manual_seed_with_google_fields",
    "prehash": "3bded80aef43c972195ec2985d3733a8b9aef4a0778db1dc86a119a876d2a9ec",
    "posthash": "0970a551bba3e4441f6cada13871307faa78c38cf1bd0b44f16c7f4c9520c593",
    "preserved_hash": "ac5c2f9e1989643f9224cc15229c7bed6a177d41aa170d74b425492f560b064a",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "c5ed89f2-ec14-4784-b037-ce1509452fcd",
    "category": "manual_seed_with_google_fields",
    "prehash": "6afcdf32bee3546f18d801aae6e006ac14bd720127a1b1d7cd91dc1b100473aa",
    "posthash": "6779117a67bfe8fbd3117a77cde9752e11600e4ec3c46cfb225fe2ba6e676b78",
    "preserved_hash": "e5ee801274826204996172ae7b66c9f3784c8df7177ea9c28d64b5926555cdbb",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","5","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "c837c6ee-14e2-4355-9763-b90d532d33ff",
    "category": "manual_seed_with_google_fields",
    "prehash": "a3ae5579950f78bee14712f805a991dc0f438d5a63f101acef26db68c782352b",
    "posthash": "4552baf6e45a69bd6bcf278585a476a9aadb967421e0cd191a84ed09d2c7950f",
    "preserved_hash": "bbbd22ea405cd9c388dc516c3e6a4fed8a9744ce3ef70f266a6364dca3bd8a8d",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "cdc66907-b7a7-4bfe-b40c-a4d11f786cae",
    "category": "manual_seed_with_google_fields",
    "prehash": "c125d3aa2e40fbe57781c014ac159526e9e7dac199be0da8e94b6fa27a498def",
    "posthash": "eeda4ab5ac8490545d6972ba359b93a30b62a17f6a58fadd5d4061586b18be39",
    "preserved_hash": "1364247cf0b14e1bbf3eb070f0075b78cb166996b36e9d08b23c53e25069b137",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "d592feeb-9802-487e-9681-fd1e32fa91b2",
    "category": "unresolved_manual_seed",
    "prehash": "2328b0704e77590fe9e48d7af991c14bcc5e7f609e99a86618723f4455e9b8d4",
    "posthash": "e973ee83ff33351cc7e5084f78a0adae4e1332cb2df3b364335227faee53535d",
    "preserved_hash": "2fe7c42222c44f1c2568f69f14ca54e32b10b99702e580bad10949d81997ab87",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "d7a1a621-49e8-40fc-80d3-dfa3a5fdf77e",
    "category": "manual_seed_with_google_fields",
    "prehash": "f5bd682c60caceae9f879ea1366a312bfb7c7e89b76b3444873981fe6f120114",
    "posthash": "d937e724c0585a5bd42a520aff14ab0697e0853d3594b8ebaf47bbcc2fa21ec9",
    "preserved_hash": "2b087f56bc5f613622af7dd22738bfe6c9a0cbf1014cea2758a8d808d10577b3",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "d98df506-c8ee-4ac3-bd49-b6d05f9828cb",
    "category": "unresolved_manual_seed",
    "prehash": "872563fede11d348ab449d89417c5098a9b943d169e6d56c1ba953ef364e4c39",
    "posthash": "ba5e33c931ced19535a13cdf5b90bb1270ecf74572671cd5bb4ddc40c40a7a14",
    "preserved_hash": "ccedd077e79ac54381cd2c5fec80f9e5909f87071be2b4c83185f3557ac7de0a",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "dc4f0cf9-5aaf-4196-9cfd-452acd845485",
    "category": "manual_seed_with_google_fields",
    "prehash": "f893effe205e2c89c9934b85515017b173470960ef0b6c3e0731d390d19da1b3",
    "posthash": "a79b32d2c257c3dded4bff54c487a8a52e386a64e310f41355ba956fc93fbbb7",
    "preserved_hash": "945c003b4d0c9c0954252fd06f7e0b05a292de4e3556a55794d381bf99955418",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "ddbd35ba-8111-4fc5-a4dc-56ec90910209",
    "category": "manual_seed_with_google_fields",
    "prehash": "1a9e920c6dfd6fd82eb032acd7593598648e94ef91ba311fcbdc8e9e5914121b",
    "posthash": "9e98f7adf8b8a9a36cb9a648a5037c1cc33cc67efa58a0d70f73b9f5109f5335",
    "preserved_hash": "2e158373dd37c5a37083431d5c05eba1de23342f1db876668d99f2d863ea9f23",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "de52d0b1-23b8-4c99-b7c3-9f74c773f043",
    "category": "unresolved_manual_seed",
    "prehash": "ed45480c8d68708befaa83d713417cb1d23b4532f31d71c76db4e6fa51fdd08b",
    "posthash": "f569fe06c813d528ebcbc258611333dd39a5be1129de5fbab369c6aa8b534b7d",
    "preserved_hash": "b5b7dad394b5d0b838fad49f18392615b7390736972a0169918f3ce1bbad0df5",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "de5854b0-c7d2-4710-8410-b40d3f9d716f",
    "category": "google_discovered",
    "prehash": "93e2d42c68228897fe282a964fd127e798d39a33c412fb021c209ce116fd3c41",
    "posthash": "e7d3aa17165ccde62c5a4f70138b2efdb612dd7795cc6f878057fe2c3f7aa168",
    "preserved_hash": "f2243eeab2f51b035fa8c5ecfee26c32148c846df14b1d748d3f21f1863d3b36",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "dfd0308c-950c-48a8-a2a9-f8adbe7a7053",
    "category": "manual_seed_with_google_fields",
    "prehash": "ea6c41c7b444e7e3d8ab2e59e02e577cea0f8b7d66cae9cadfa71b2a3505936d",
    "posthash": "995d2b105940a7bd74093521de56de491a2e9fcad746ddf04c0f252bc2533399",
    "preserved_hash": "4140cd076bfb0e4e9f81f13dc1e52da7d159dfdd737e99f1df55fbde0f8140b6",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "e1d07c29-24c5-4986-ba8f-4ef491dd9c8f",
    "category": "manual_seed_with_google_fields",
    "prehash": "c4a47182dd280f51ed4f5581ada2e9dcaee9e7aaf47d95c3830d1b4f0f96bf00",
    "posthash": "14c27475ade7d768d3eb40cec4efbd4293ba730c8c3673f492dfa91683a60661",
    "preserved_hash": "ee92b19c464f319fcabe11ecfbea08c53b81df3bb106844869cbf29d7c8d226b",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "e31c2200-b398-43c1-a79f-d6949ea0e70e",
    "category": "manual_seed_with_google_fields",
    "prehash": "6f28c0953ae4583066230d86ab78582c6d33a09f6ed2725d9ee85fc5440354ba",
    "posthash": "fcaa8a571a0d8640257d2b383a668490ec853652ca673fbee2f63512e5eb21c6",
    "preserved_hash": "f5b9b6a49f7b150665c2cac71cc4feab6bd1511f4c4debb0d3bcd634d04d693b",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "e764fea7-d255-4848-bcaf-deb6da16cae2",
    "category": "manual_seed_with_google_fields",
    "prehash": "239839da60c3b18036c5589aaca336d0e4fe6af1988ffcdbd3c7ad0a742a7451",
    "posthash": "a44266cccf1a0b1a56a33676ffbc5a95e84637d5ae8b5865438a5e6d7178e6f4",
    "preserved_hash": "33995b8dad1bc20a8a6a1780e6beb41243a48b56188ea67f27ab8f3f1d2c8d04",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "ec20688b-7516-456a-98bf-5f2b825caf4f",
    "category": "unresolved_manual_seed",
    "prehash": "e4b25434d1aef8e4081d25d6c3d31f5d22acc78d00853d9e55533ec24b20d0c7",
    "posthash": "995ed2e24b6482906a0b29f83bd3ad20c44c0b0bd27667ee9973021bc53d7d8e",
    "preserved_hash": "7d64e34a16dc202b52c61f86bb91699704e8d659f5120ebf300384a47a03a978",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "ec7cac87-f735-4b24-9e97-d7caec583ec3",
    "category": "manual_seed_with_google_fields",
    "prehash": "db86d83188555121beabfada5e0c9897c8fae11b96cf660b68c018e79f62d1cd",
    "posthash": "db548e37855c681c31887518824f74e502b56a300a98d418ccc2148047826a51",
    "preserved_hash": "6b178109f4e2543ead03d47584d4f20aac1da055343a5854032a20a7d98d87ed",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_email"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "ecd87e5c-2907-4d85-97ab-6800ccbcdac8",
    "category": "unresolved_manual_seed",
    "prehash": "a0c9ef8280525bf8b0bbd92f547d338e04e95bce8ead39031ea7c8970fffb409",
    "posthash": "82020c77ffb1831f43220673fb4f783f9dea7eb5c4444b744f282bd21bbd16f1",
    "preserved_hash": "c9a8a3bd818cdc747d2220b1942e04e786c72b8d97b266d5d2ba1dab1322b4b5",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "f59c8258-f736-4c24-83ea-8d53e6ca7d80",
    "category": "google_discovered",
    "prehash": "5e1c14ddf49ec1475597fc10b207dc1869eddc032b216d48711f2839605618e1",
    "posthash": "bfb99c117c7f01d173a0fbfbbb1968b511398086baf1d5f198ac99943769aec9",
    "preserved_hash": "7eef3d76ba0050d02ed222d11a5f34b4d41bc260b5cf0bbe07ad293ac20950fd",
    "remove": [["metadata","google_primary_type"],["metadata","google_types"],["metadata","google_price_level"],["metadata","google_business_status"],["metadata","places_primary_type_match"],["metadata","places_all_types"],["metadata","venue_cluster_id"],["metadata","subspace_hint"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["lat"],"value":null},{"path":["lng"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["photos"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "f704e646-1ad5-4f56-9dcc-d45afb1c7518",
    "category": "manual_seed_with_google_fields",
    "prehash": "86cd6260b275a541b692011aa80e06af6e65c177be4812c7ab76494e98dcda63",
    "posthash": "117751a0cca440ba15e37f86b1757253e1957fcda906a5bc22775aa7d448a08c",
    "preserved_hash": "5a950538c5a75cf2f88b1daa6ef6264ac729dc077ef66f7c1cfcb9ed24c5a387",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","1","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "fbf8b527-75a2-45a2-89e4-326d8b4546d0",
    "category": "manual_seed_with_google_fields",
    "prehash": "e31781a6dd1870c1626d14cf0562a2575c9bf08799665be83a595db50529f6f2",
    "posthash": "a81a9dde6db9688f5e5bb1c0c4e926e18a8eb94cab74868cc1e2ab636b56e7a3",
    "preserved_hash": "706920bd3dd61c3ab05789d7813f0742efdb4e0ee69d6040b3b71d522a13c148",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]},{"path":["extracted_emails","0","is_likely_booking_contact"],"value":false}],
    "serialized": []
  },
  {
    "table": "discovery_venues",
    "id": "fff7cc7c-7c6f-4840-8ce4-ef6973372581",
    "category": "manual_seed_with_google_fields",
    "prehash": "74df505cdecf60bd78623e48250aadd37389b4dd6ba9777e05a078ad35290cc7",
    "posthash": "54ba13cdc4992abb362f6540cbe8a86ba79d0ea68c4453e97cd17fbbc06b28e7",
    "preserved_hash": "f8b3c4c3b008f4597382435f3cd0871b2d60bd7cc057ef8fcfb07321e0b7f09b",
    "remove": [["metadata","amenities"],["metadata","capacity_min"],["metadata","capacity_max"],["metadata","capacity_range_label"],["metadata","price_tier"],["metadata","venue_type"]],
    "set": [{"path":["name"],"value":null},{"path":["address"],"value":null},{"path":["neighborhood"],"value":null},{"path":["city"],"value":null},{"path":["state"],"value":null},{"path":["contact_phone"],"value":null},{"path":["website"],"value":null},{"path":["capacity_seated"],"value":null},{"path":["capacity_standing"],"value":null},{"path":["capacity_cocktail"],"value":null},{"path":["google_rating"],"value":null},{"path":["google_user_ratings_total"],"value":null},{"path":["business_status"],"value":null},{"path":["vibe_tags"],"value":[]}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "00599fff-7366-4e0e-a12d-48454ff94621",
    "category": "legacy_google_venue_copy",
    "prehash": "14c6e2ba34cfdfa27837b4066915f7a90dc694d0366b564794b6d06cfdb9d23b",
    "posthash": "85b5f778279483115f05bf3d79f45af70e41f3ec5f70cb450470b48c3b4da7ea",
    "preserved_hash": "7003e74268f71103a2e36b948e0d2c2536801edf8d089d03b7309912fca9afe7",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "5caaabcf-5ca9-4b26-9b0b-a02c681991c8",
    "category": "legacy_google_venue_copy",
    "prehash": "907cdea3a31b689e58fb6c06e1f66f842d3d46bd38cf0a4d5bdb28945fc36694",
    "posthash": "1d307c2c96c94a3d0b82c4f19a1143135b0bdc1ee2a05c2c9e7268d2c7363b70",
    "preserved_hash": "a9058ac9ee198bffc2bbb7375c0210d53b60a914463dae2b6fe974df88b39b7d",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "71df8f5e-c29e-4571-bfcc-310d45b4d3a8",
    "category": "legacy_google_venue_copy",
    "prehash": "90d0ece53f426c25b1fa87f5df81272f282e1059bd3fc8c9c21498d5fecfda0f",
    "posthash": "c9f8eec8f17ef958d6afb17a35320fa786f3faa9559776886deda17b2139384e",
    "preserved_hash": "3ae593de19b754209b7717a9b4391bcd70f16c5b375ec82a454a1a8cfffaa684",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "7291c1a3-e501-4211-8946-146f0ac49dd4",
    "category": "legacy_google_venue_copy",
    "prehash": "bdc847ad8f8dd01ea0dfba96c958ffb560de90b9bc050a07e2cc0ac92daec1f5",
    "posthash": "a568329f4882ab5fc0fb2a57761df3170efb7c9c31b2d3621489fe13a23e61b1",
    "preserved_hash": "712a0b17b0f36b882fcf43f351882de721ca1b3a10bd3c567297ba7ea1d55f0b",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "8e53d74a-b29e-438b-8430-6eed5e11c981",
    "category": "legacy_google_venue_copy",
    "prehash": "3789899e2e653253c241bea66a01b804d6743c2c159cc1b203ae8f5d48d2e90b",
    "posthash": "f2ce998b637a9f994669cc42606209af12c3e8f7d7fd9eae77241abc6452dece",
    "preserved_hash": "a0fae0ca256930edadaa7b4a742825b4411b65e40169c9d47157589b0d87fe8e",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "929f67d4-45eb-4cc5-9aba-532ce1877180",
    "category": "legacy_google_venue_copy",
    "prehash": "4dc17f373b23e618ce235a5743ec8abefb19b8b44ea8e0bc15a8da421301647e",
    "posthash": "43e4cd9a5b9cec696ed271c28d6a94bfedc24ff982fdac903bb48bc4f007f82f",
    "preserved_hash": "32b247732fbd114bb91676e86bc98f605eb38a9dcc6f37cc6dbe98c559c12606",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "d76c0883-a03d-49dc-bf41-3e959742dd77",
    "category": "legacy_google_venue_copy",
    "prehash": "14a17d4b03c678f78b088862b6da2a8861c40135e92713ed00efb3125a47e16a",
    "posthash": "50f7365a6cfe877f9b6d49943ff6c94c1990cdb5a575cf18b48fde987c213651",
    "preserved_hash": "59e0257b4059c301326dec29e17f5110fed0a5d08868aac34bf85fc56899d41b",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "da3f475c-66ea-4dc1-a162-89b5522469b6",
    "category": "legacy_google_venue_copy",
    "prehash": "74a222d0325626e8a607f576cb0a79154f1978194577a5435dba2322d9e21a05",
    "posthash": "9378915bf1c92c710fa62b61d62b1f77e6bda1f7bb9ae7fe51d45ccaeab257e4",
    "preserved_hash": "ee609ee6ebf5dbc7a2efc795d23e3088a28df97a2c2f3cb04cc3af76b7ac5ccd",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "db5f63f4-de2f-4c61-9513-1fbf18898338",
    "category": "legacy_google_venue_copy",
    "prehash": "ae1c96a4cf1679b6bef3056ebd0c01b678b72cff51b501d7f0ea424fbd3b04e1",
    "posthash": "6eb4cd15115bc4d0e85936337a88230e353bc6b7dacd4a1ae1ec586099a40a60",
    "preserved_hash": "92aaa4dc5c2ac5ab6531b10c73f597b1007c5d0f8ea4839c4938c9e43dae83d0",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "dfe47ba7-296b-4e8d-b9c5-8889a376b696",
    "category": "legacy_google_venue_copy",
    "prehash": "22f330f174b7123b73cb79e22fec7bc4eb9cb3b2e226dd6946bf98ff7b20f8c1",
    "posthash": "56d4b9e61eee163e67e12f547895dd019cbf5d76d40141bfdabaa316235413e9",
    "preserved_hash": "0dad40a7ce51abf9a4baaf40f31bb19cd531d9bb8f1795d2235bfa0dce0723ed",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_discovery_venue_candidates",
    "id": "e881c444-301c-4f26-b51d-8d81e03b90b6",
    "category": "legacy_google_venue_copy",
    "prehash": "3600b10dba3cd82890546b061601fdad5446426b40f35547c926e93a71db3b47",
    "posthash": "dcef23aa104b832aca293c9284933cdf6017ed66fd4a584048319357c45090e1",
    "preserved_hash": "3e3d9ee3b5b78f4cc391a5fc81b43360721ced15cc7565b73392c6abb13dc830",
    "remove": [],
    "set": [{"path":["fit_score"],"value":null}],
    "serialized": []
  },
  {
    "table": "plan_messages",
    "id": "5b7c32a6-8015-4fba-b159-7d3931269ea5",
    "category": "legacy_google_venue_copy",
    "prehash": "a670af72aa603382954962630277703fa5756d09931f9c77c491c9e6d9e8b059",
    "posthash": "9843d4120902a85aac1370dd121a86bb64674554de33a18cb59453bd5874ba39",
    "preserved_hash": "73371fddec00a067022d6d3ca23905d288cf5d825d70208ddb488b72a2c1ffe6",
    "remove": [["metadata","ranked_venues","0","venue_name"],["metadata","ranked_venues","0","capacity_known"],["metadata","ranked_venues","0","website"],["metadata","ranked_venues","0","contact_phone"],["metadata","ranked_venues","0","contact_email"],["metadata","ranked_venues","0","contact_email_source"],["metadata","ranked_venues","0","contact_email_confidence"],["metadata","ranked_venues","0","contact_status"],["metadata","ranked_venues","0","fit_score"],["metadata","ranked_venues","0","pros"],["metadata","ranked_venues","0","cons"],["metadata","ranked_venues","0","archetype_reasons"],["metadata","ranked_venues","0","user_facing_intro"],["metadata","ranked_venues","0","commercial_model_match"],["metadata","ranked_venues","0","questions_to_ask_venue"],["metadata","recommendation_response","ranked_venues","0","venue_name"],["metadata","recommendation_response","ranked_venues","0","capacity_known"],["metadata","recommendation_response","ranked_venues","0","website"],["metadata","recommendation_response","ranked_venues","0","contact_phone"],["metadata","recommendation_response","ranked_venues","0","contact_email"],["metadata","recommendation_response","ranked_venues","0","contact_email_source"],["metadata","recommendation_response","ranked_venues","0","contact_email_confidence"],["metadata","recommendation_response","ranked_venues","0","contact_status"],["metadata","recommendation_response","ranked_venues","0","fit_score"],["metadata","recommendation_response","ranked_venues","0","pros"],["metadata","recommendation_response","ranked_venues","0","cons"],["metadata","recommendation_response","ranked_venues","0","archetype_reasons"],["metadata","recommendation_response","ranked_venues","0","user_facing_intro"],["metadata","recommendation_response","ranked_venues","0","commercial_model_match"],["metadata","recommendation_response","ranked_venues","0","questions_to_ask_venue"],["metadata","recommendation_response","recommendations","0","venue_name"],["metadata","recommendation_response","recommendations","0","capacity_known"],["metadata","recommendation_response","recommendations","0","website"],["metadata","recommendation_response","recommendations","0","contact_phone"],["metadata","recommendation_response","recommendations","0","contact_email"],["metadata","recommendation_response","recommendations","0","contact_email_source"],["metadata","recommendation_response","recommendations","0","contact_email_confidence"],["metadata","recommendation_response","recommendations","0","contact_status"],["metadata","recommendation_response","recommendations","0","fit_score"],["metadata","recommendation_response","recommendations","0","pros"],["metadata","recommendation_response","recommendations","0","cons"],["metadata","recommendation_response","recommendations","0","archetype_reasons"],["metadata","recommendation_response","recommendations","0","user_facing_intro"],["metadata","recommendation_response","recommendations","0","commercial_model_match"],["metadata","recommendation_response","recommendations","0","questions_to_ask_venue"],["metadata","recommendations","0","name"],["metadata","recommendations","0","fit"],["metadata","recommendations","0","note"],["metadata","recommendations","0","tags"],["metadata","recommendations","0","archetype_reasons"],["metadata","recommendations","0","commercial_model_match"]],
    "set": [{"path":["content"],"value":"Earlier generated content is unavailable pending source verification."},{"path":["metadata","venue_content_unavailable"],"value":true},{"path":["metadata","unavailable_code"],"value":"legacy_discovery_evidence_missing"}],
    "serialized": []
  },
  {
    "table": "plan_messages",
    "id": "c40f3ba4-bc93-4d89-b500-0187f60dbb8e",
    "category": "legacy_google_venue_copy",
    "prehash": "66214a24a80e482c418d54d6fb59bd9b41eb5334e8c3526f43363e808b640ee0",
    "posthash": "1331016dc979eac326640b1a60f2ae7640fd462a72bd2b1646dae7c50d4d01d4",
    "preserved_hash": "89b2cd0350da6103104601d7cf9b64075f73e884e4f5b51a4d642f25156d94e3",
    "remove": [["metadata","ranked_venues","0","venue_name"],["metadata","ranked_venues","0","capacity_known"],["metadata","ranked_venues","0","website"],["metadata","ranked_venues","0","contact_phone"],["metadata","ranked_venues","0","contact_status"],["metadata","ranked_venues","0","fit_score"],["metadata","ranked_venues","0","pros"],["metadata","ranked_venues","0","cons"],["metadata","ranked_venues","0","archetype_reasons"],["metadata","ranked_venues","0","user_facing_intro"],["metadata","ranked_venues","0","commercial_model_match"],["metadata","ranked_venues","0","questions_to_ask_venue"],["metadata","recommendation_response","ranked_venues","0","venue_name"],["metadata","recommendation_response","ranked_venues","0","capacity_known"],["metadata","recommendation_response","ranked_venues","0","website"],["metadata","recommendation_response","ranked_venues","0","contact_phone"],["metadata","recommendation_response","ranked_venues","0","contact_status"],["metadata","recommendation_response","ranked_venues","0","fit_score"],["metadata","recommendation_response","ranked_venues","0","pros"],["metadata","recommendation_response","ranked_venues","0","cons"],["metadata","recommendation_response","ranked_venues","0","archetype_reasons"],["metadata","recommendation_response","ranked_venues","0","user_facing_intro"],["metadata","recommendation_response","ranked_venues","0","commercial_model_match"],["metadata","recommendation_response","ranked_venues","0","questions_to_ask_venue"],["metadata","recommendation_response","recommendations","0","venue_name"],["metadata","recommendation_response","recommendations","0","capacity_known"],["metadata","recommendation_response","recommendations","0","website"],["metadata","recommendation_response","recommendations","0","contact_phone"],["metadata","recommendation_response","recommendations","0","contact_status"],["metadata","recommendation_response","recommendations","0","fit_score"],["metadata","recommendation_response","recommendations","0","pros"],["metadata","recommendation_response","recommendations","0","cons"],["metadata","recommendation_response","recommendations","0","archetype_reasons"],["metadata","recommendation_response","recommendations","0","user_facing_intro"],["metadata","recommendation_response","recommendations","0","commercial_model_match"],["metadata","recommendation_response","recommendations","0","questions_to_ask_venue"],["metadata","recommendations","0","name"],["metadata","recommendations","0","fit"],["metadata","recommendations","0","note"],["metadata","recommendations","0","tags"],["metadata","recommendations","0","archetype_reasons"],["metadata","recommendations","0","commercial_model_match"]],
    "set": [{"path":["content"],"value":"Earlier generated content is unavailable pending source verification."},{"path":["metadata","venue_content_unavailable"],"value":true},{"path":["metadata","unavailable_code"],"value":"legacy_discovery_evidence_missing"}],
    "serialized": []
  },
  {
    "table": "plan_messages",
    "id": "f8a6a6ae-9ec3-4962-82a4-bf46194620dc",
    "category": "legacy_google_venue_copy",
    "prehash": "0246e0fbb0de65c551f9696cb7552706e237b6aa669e497b4563453007e39c16",
    "posthash": "b851bf56a8718cd468c911b6806eee24858a5bc8c4fed3d2d800bf6697cf796a",
    "preserved_hash": "a0816a3a7fb434716e5d2dec7a4e708a1b04fc6fc79983a7ce889e1902a2af6b",
    "remove": [["metadata","ranked_venues","0","venue_name"],["metadata","ranked_venues","0","capacity_known"],["metadata","ranked_venues","0","website"],["metadata","ranked_venues","0","contact_phone"],["metadata","ranked_venues","0","contact_status"],["metadata","ranked_venues","0","fit_score"],["metadata","ranked_venues","0","pros"],["metadata","ranked_venues","0","cons"],["metadata","ranked_venues","0","archetype_reasons"],["metadata","ranked_venues","0","user_facing_intro"],["metadata","ranked_venues","0","commercial_model_match"],["metadata","ranked_venues","0","questions_to_ask_venue"],["metadata","recommendation_response","ranked_venues","0","venue_name"],["metadata","recommendation_response","ranked_venues","0","capacity_known"],["metadata","recommendation_response","ranked_venues","0","website"],["metadata","recommendation_response","ranked_venues","0","contact_phone"],["metadata","recommendation_response","ranked_venues","0","contact_status"],["metadata","recommendation_response","ranked_venues","0","fit_score"],["metadata","recommendation_response","ranked_venues","0","pros"],["metadata","recommendation_response","ranked_venues","0","cons"],["metadata","recommendation_response","ranked_venues","0","archetype_reasons"],["metadata","recommendation_response","ranked_venues","0","user_facing_intro"],["metadata","recommendation_response","ranked_venues","0","commercial_model_match"],["metadata","recommendation_response","ranked_venues","0","questions_to_ask_venue"],["metadata","recommendation_response","recommendations","0","venue_name"],["metadata","recommendation_response","recommendations","0","capacity_known"],["metadata","recommendation_response","recommendations","0","website"],["metadata","recommendation_response","recommendations","0","contact_phone"],["metadata","recommendation_response","recommendations","0","contact_status"],["metadata","recommendation_response","recommendations","0","fit_score"],["metadata","recommendation_response","recommendations","0","pros"],["metadata","recommendation_response","recommendations","0","cons"],["metadata","recommendation_response","recommendations","0","archetype_reasons"],["metadata","recommendation_response","recommendations","0","user_facing_intro"],["metadata","recommendation_response","recommendations","0","commercial_model_match"],["metadata","recommendation_response","recommendations","0","questions_to_ask_venue"],["metadata","recommendations","0","name"],["metadata","recommendations","0","fit"],["metadata","recommendations","0","note"],["metadata","recommendations","0","tags"],["metadata","recommendations","0","archetype_reasons"],["metadata","recommendations","0","commercial_model_match"]],
    "set": [{"path":["content"],"value":"Earlier generated content is unavailable pending source verification."},{"path":["metadata","venue_content_unavailable"],"value":true},{"path":["metadata","unavailable_code"],"value":"legacy_discovery_evidence_missing"}],
    "serialized": []
  },
  {
    "table": "recommendations",
    "id": "c208e4ea-f5a6-42a2-88a1-a66b0136d6dc",
    "category": "legacy_google_venue_copy",
    "prehash": "b44bdb01d061bfd26ce33a1ca3c83c9bc0d3011ccf4ca2e0cdca38004914bee3",
    "posthash": "fce13ce29d22ec53712756551ca1ce7332cbe01ed2c127782acbaf752ea7ef08",
    "preserved_hash": "84d537eaf50c16c1761dfe4ea6c5f6cabdebd8e01bfb6442d5d8991df8053dbf",
    "remove": [["metadata","fit_score"],["metadata","pros"],["metadata","cons"],["metadata","user_facing_intro"],["metadata","reason_summary"],["metadata","questions_to_ask_venue"],["metadata","capacity_known"],["metadata","archetype","display_name"]],
    "set": [{"path":["notes"],"value":null},{"path":["status"],"value":"superseded"},{"path":["is_best_fit"],"value":false},{"path":["metadata","venue_content_unavailable"],"value":true},{"path":["metadata","unavailable_code"],"value":"legacy_discovery_evidence_missing"}],
    "serialized": []
  },
  {
    "table": "recommendations",
    "id": "c25d1d83-ebd0-44b2-97a5-889c5b0dad72",
    "category": "legacy_google_venue_copy",
    "prehash": "196fdc76163a7faaf4a239bd2bd239951cf23b5121d38154c94f83f1beae1e7d",
    "posthash": "f44e06757c881e1277afc60d43ed286a66325b5c163b58de31bf65d14e1835f0",
    "preserved_hash": "528f750382d6b1bdc4ef32a0d90bbb744baeb4c2aa557244814da2751bc4acd8",
    "remove": [["metadata","fit_score"],["metadata","pros"],["metadata","cons"],["metadata","user_facing_intro"],["metadata","reason_summary"],["metadata","questions_to_ask_venue"],["metadata","capacity_known"],["metadata","archetype","display_name"]],
    "set": [{"path":["notes"],"value":null},{"path":["status"],"value":"superseded"},{"path":["is_best_fit"],"value":false},{"path":["metadata","venue_content_unavailable"],"value":true},{"path":["metadata","unavailable_code"],"value":"legacy_discovery_evidence_missing"}],
    "serialized": []
  },
  {
    "table": "recommendations",
    "id": "c9d4d56a-294a-4a5a-822f-fa16ab52f5a8",
    "category": "legacy_google_venue_copy",
    "prehash": "46fda9ee1491cd703179ef99cf78147ad69e73914df77f13e0c46c555daff1f2",
    "posthash": "3913cd99665b8abe5cca623ca1efdcef4fc0b55d6f8b7b95aaeb89fb87eb6e11",
    "preserved_hash": "74115e7e6bc6519b09878e3942d4ac8fc54fb9eb4fffe7ee2b44122ea23c7e62",
    "remove": [["metadata","fit_score"],["metadata","pros"],["metadata","cons"],["metadata","user_facing_intro"],["metadata","reason_summary"],["metadata","questions_to_ask_venue"],["metadata","capacity_known"],["metadata","archetype","display_name"]],
    "set": [{"path":["notes"],"value":null},{"path":["status"],"value":"superseded"},{"path":["is_best_fit"],"value":false},{"path":["metadata","venue_content_unavailable"],"value":true},{"path":["metadata","unavailable_code"],"value":"legacy_discovery_evidence_missing"}],
    "serialized": []
  }
]$reviewed_manifest$::JSONB;
  -- END REVIEWED MANIFEST DATA
  v_tables CONSTANT TEXT[] := ARRAY['agent_runs','discovery_venues',
    'plan_discovery_venue_candidates','plan_messages','recommendations'];
  v_spec JSONB; v_serial JSONB; v_op JSONB; v_path TEXT[]; v_table TEXT;
  v_before JSONB; v_after JSONB; v_saved JSONB; v_inner JSONB;
  v_preserved JSONB; v_preserved_inner JSONB; v_originals JSONB := '{}';
  v_targets JSONB := '{}'; v_hash TEXT; v_catalog JSONB;
  v_stats JSONB; v_stats_after JSONB; v_contacts JSONB; v_contacts_after JSONB;
  v_state TEXT; v_enabled BOOLEAN; v_needs_work BOOLEAN := false;
  v_present INTEGER := 0; v_changed INTEGER := 0; v_deep BOOLEAN;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'legacy_venue_purge_requires_read_committed' USING ERRCODE='25001';
  END IF;
  -- The same ordering as the pause toggle: retain this SHARE lock until the
  -- outer transaction commits. Reopening takes UPDATE and must wait for us.
  SELECT state,enabled INTO v_state,v_enabled FROM public.release_runtime_controls
    WHERE control_key='write_pause' FOR SHARE;
  -- Lock every target table before reading any target. This bounded short-window
  -- lock also closes missing-row/derived-insert races; readers remain available.
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',v_table);
  END LOOP;
  FOR v_spec IN SELECT value FROM jsonb_array_elements(v_manifest) LOOP
    v_table := v_spec->>'table';
    IF NOT v_table=ANY(v_tables) THEN
      RAISE EXCEPTION 'legacy_venue_purge_invalid_table' USING ERRCODE='22023';
    END IF;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',v_table)
      INTO v_before USING (v_spec->>'id')::UUID;
    IF v_before IS NULL THEN CONTINUE; END IF;
    v_present := v_present+1;
    v_originals := jsonb_set(v_originals,ARRAY[v_spec->>'id'],v_before);
    v_hash := encode(sha256(convert_to((v_before-'updated_at')::TEXT,'UTF8')),'hex');
    IF v_hash IS DISTINCT FROM v_spec->>'posthash' THEN v_needs_work := true; END IF;
  END LOOP;
  -- A fresh reset/bootstrap has none of these historical identities; unrelated
  -- rows are not a cleanup selector and require no pause or mutation.
  IF v_present=0 THEN RETURN; END IF;
  IF v_needs_work AND (v_enabled IS DISTINCT FROM true OR v_state IS DISTINCT FROM 'paused') THEN
    RAISE EXCEPTION 'legacy_venue_purge_requires_write_pause' USING ERRCODE='55000';
  END IF;
  IF v_present<>113 OR jsonb_array_length(v_manifest)<>113 THEN
    RAISE EXCEPTION 'legacy_venue_purge_partial_cohort' USING ERRCODE='22023';
  END IF;
  IF NOT v_needs_work THEN
    RAISE NOTICE 'legacy_venue_purge reviewed_rows=%, changed_rows=0',v_present;
    RETURN;
  END IF;
  -- Reject an added audit-capture trigger/rule BEFORE any data can be copied.
  -- The reviewed nine triggers stay enabled, including timestamp triggers.
  SELECT jsonb_build_object('triggers',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid)) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY['discovery_venues','plan_discovery_venue_candidates','recommendations','plan_messages','agent_runs']) AND NOT t.tgisinternal),'rules',(SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',rulename,'definition',definition) ORDER BY tablename,rulename) FROM pg_rules WHERE schemaname='public' AND tablename=ANY(ARRAY['discovery_venues','plan_discovery_venue_candidates','recommendations','plan_messages','agent_runs']))) INTO v_catalog;
  IF encode(sha256(convert_to(v_catalog::TEXT,'UTF8')),'hex') <> '55d22f7d5ffc1c4f954753215592bf17523ff00a9de71239e481d05020315ea9' THEN
    RAISE EXCEPTION 'legacy_venue_purge_trigger_contract_changed' USING ERRCODE='22023';
  END IF;
  -- Derived state is deliberately outside D. It can contain money/authorization.
  -- Locking prevents a cached proposal being inserted after this absence check.
  LOCK TABLE public.plan_derived_state IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.plan_derived_state d JOIN public.recommendations r ON r.plan_id=d.plan_id
    WHERE r.id IN (SELECT (value->>'id')::UUID FROM jsonb_array_elements(v_manifest)
      WHERE value->>'table'='recommendations')) THEN
    RAISE EXCEPTION 'legacy_venue_purge_derived_cache_requires_review' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_object_agg(relid::TEXT,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)) INTO v_stats
    FROM pg_stat_xact_user_tables WHERE NOT (schemaname='public' AND relname=ANY(v_tables));

  -- Preflight ALL original/post images before the first UPDATE. Any unexpected
  -- state aborts the caller's transaction. No catch/skip or per-node handler.
  FOR v_spec IN SELECT value FROM jsonb_array_elements(v_manifest) LOOP
    v_table := v_spec->>'table'; v_before := v_originals->(v_spec->>'id');
    v_hash := encode(sha256(convert_to((v_before-'updated_at')::TEXT,'UTF8')),'hex');
    IF v_hash = v_spec->>'posthash' THEN CONTINUE; END IF;
    IF v_hash IS DISTINCT FROM v_spec->>'prehash' THEN
      RAISE EXCEPTION 'legacy_venue_purge_preimage_changed' USING ERRCODE='22023',DETAIL=v_spec->>'id';
    END IF;
    IF v_table='recommendations' AND (v_before->>'status' IS DISTINCT FROM 'pending'
      OR v_before->'external_name' IS DISTINCT FROM 'null'::JSONB
      OR v_before->'price_cents' IS DISTINCT FROM 'null'::JSONB) THEN
      RAISE EXCEPTION 'legacy_venue_purge_commercial_state_changed' USING ERRCODE='22023';
    END IF;
    IF v_table='recommendations' AND (
      EXISTS(SELECT 1 FROM public.approvals a WHERE strpos(to_jsonb(a)::TEXT,v_spec->>'id')>0)
      OR EXISTS(SELECT 1 FROM public.venue_bookings b WHERE strpos(to_jsonb(b)::TEXT,v_spec->>'id')>0)
      OR EXISTS(SELECT 1 FROM public.vendor_bookings b WHERE strpos(to_jsonb(b)::TEXT,v_spec->>'id')>0)
    ) THEN
      RAISE EXCEPTION 'legacy_venue_purge_commercial_reference_requires_review' USING ERRCODE='22023';
    END IF;
    v_after := v_before;
    FOR v_serial IN SELECT value FROM jsonb_array_elements(v_spec->'serialized') LOOP
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_serial->'path')) INTO v_path;
      IF jsonb_typeof(v_after#>v_path) IS DISTINCT FROM 'string'
        OR NOT ((v_after#>>v_path) IS JSON OBJECT) THEN
        RAISE EXCEPTION 'legacy_venue_purge_invalid_serialized_object' USING ERRCODE='22023';
      END IF;
      v_after := jsonb_set(v_after,v_path,(v_after#>>v_path)::JSONB);
    END LOOP;
    -- One bounded recursive CTE, no recursive PL/pgSQL helper/subtransaction.
    WITH RECURSIVE nodes(value,depth) AS (
      SELECT v_after,0 UNION ALL
      SELECT c.value,n.depth+1 FROM nodes n CROSS JOIN LATERAL (
        SELECT e.value FROM jsonb_each(CASE WHEN jsonb_typeof(n.value)='object' THEN n.value ELSE '{}' END) e
        UNION ALL SELECT a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.value)='array' THEN n.value ELSE '[]' END) a
      ) c WHERE n.depth<65
    ) SELECT EXISTS(SELECT 1 FROM nodes WHERE depth>64) INTO v_deep;
    IF v_deep THEN RAISE EXCEPTION 'legacy_venue_purge_payload_depth' USING ERRCODE='22023'; END IF;

    v_preserved := v_after-'updated_at';
    -- Root paths are typed column/object positions; serialized paths are relative
    -- to the two explicitly parsed agent-run JSON strings, never arbitrary text.
    FOR v_op IN SELECT value FROM jsonb_array_elements(v_spec->'remove') LOOP
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_op)) INTO v_path;
      v_after := v_after #- v_path; v_preserved := v_preserved #- v_path;
    END LOOP;
    FOR v_op IN SELECT value FROM jsonb_array_elements(v_spec->'set') LOOP
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_op->'path')) INTO v_path;
      v_after := jsonb_set(v_after,v_path,v_op->'value',true); v_preserved := v_preserved #- v_path;
    END LOOP;
    FOR v_serial IN SELECT value FROM jsonb_array_elements(v_spec->'serialized') LOOP
      SELECT ARRAY(SELECT jsonb_array_elements_text(v_serial->'path')) INTO v_path;
      v_inner := v_after#>v_path; v_preserved_inner := v_preserved#>v_path;
      FOR v_op IN SELECT value FROM jsonb_array_elements(v_serial->'remove') LOOP
        v_inner := v_inner #- ARRAY(SELECT jsonb_array_elements_text(v_op));
        v_preserved_inner := v_preserved_inner #- ARRAY(SELECT jsonb_array_elements_text(v_op));
      END LOOP;
      FOR v_op IN SELECT value FROM jsonb_array_elements(v_serial->'set') LOOP
        v_inner := jsonb_set(v_inner,ARRAY(SELECT jsonb_array_elements_text(v_op->'path')),v_op->'value',true);
        v_preserved_inner := v_preserved_inner #- ARRAY(SELECT jsonb_array_elements_text(v_op->'path'));
      END LOOP;
      PERFORM private.assert_venue_durable_json(v_inner,false,NULL,0,NULL,'agent_runs');
      PERFORM private.assert_vendor_durable_json(v_inner,false,NULL,0,NULL,'agent_runs');
      v_after := jsonb_set(v_after,v_path,to_jsonb(v_inner::TEXT));
      v_preserved := jsonb_set(v_preserved,v_path,to_jsonb(v_preserved_inner::TEXT));
    END LOOP;
    IF encode(sha256(convert_to(v_preserved::TEXT,'UTF8')),'hex') IS DISTINCT FROM v_spec->>'preserved_hash'
      OR encode(sha256(convert_to((v_after-'updated_at')::TEXT,'UTF8')),'hex') IS DISTINCT FROM v_spec->>'posthash' THEN
      RAISE EXCEPTION 'legacy_venue_purge_projection_mismatch' USING ERRCODE='22023',DETAIL=v_spec->>'id';
    END IF;
    IF v_table='discovery_venues' THEN
      v_contacts := private.discovery_venue_safe_json(v_before);
      v_contacts_after := private.discovery_venue_safe_json(v_after);
      FOREACH v_table IN ARRAY ARRAY['extracted_emails','extracted_contact_forms','organizer_provided_emails'] LOOP
        IF v_contacts->v_table IS DISTINCT FROM v_contacts_after->v_table THEN
          RAISE EXCEPTION 'legacy_venue_purge_independent_contacts_changed' USING ERRCODE='22023';
        END IF;
      END LOOP;
      v_table := v_spec->>'table';
    ELSE
      PERFORM private.assert_venue_durable_json(v_after,false,NULL,0,NULL,v_table);
      PERFORM private.assert_vendor_durable_json(v_after,false,NULL,0,NULL,v_table);
    END IF;
    v_targets := jsonb_set(v_targets,ARRAY[v_spec->>'id'],v_after);
  END LOOP;

  FOR v_spec IN SELECT value FROM jsonb_array_elements(v_manifest) LOOP
    v_after := v_targets->(v_spec->>'id');
    IF v_after IS NULL THEN CONTINUE; END IF; -- exact clean postimage: no UPDATE/timestamp
    CASE v_spec->>'table'
      WHEN 'discovery_venues' THEN
        UPDATE public.discovery_venues t SET
          name=n.name,address=n.address,neighborhood=n.neighborhood,city=n.city,state=n.state,
          contact_email=n.contact_email,contact_phone=n.contact_phone,website=n.website,instagram_handle=n.instagram_handle,
          capacity_seated=n.capacity_seated,capacity_standing=n.capacity_standing,capacity_cocktail=n.capacity_cocktail,
          vibe_tags=n.vibe_tags,alcohol_policy=n.alcohol_policy,av_available=n.av_available,parking_notes=n.parking_notes,
          inferred_capacity_standing=n.inferred_capacity_standing,inferred_capacity_seated=n.inferred_capacity_seated,
          capacity_inference_confidence=n.capacity_inference_confidence,capacity_inference_source_quote=n.capacity_inference_source_quote,
          capacity_inference_model=n.capacity_inference_model,lat=n.lat,lng=n.lng,google_rating=n.google_rating,
          google_user_ratings_total=n.google_user_ratings_total,business_status=n.business_status,photos=n.photos,
          google_photo_names=n.google_photo_names,opening_hours_json=n.opening_hours_json,metadata=n.metadata,extracted_emails=n.extracted_emails
        FROM jsonb_populate_record(NULL::public.discovery_venues,v_after) n WHERE t.id=n.id RETURNING to_jsonb(t) INTO v_saved;
      WHEN 'plan_discovery_venue_candidates' THEN
        UPDATE public.plan_discovery_venue_candidates t SET fit_score=n.fit_score
        FROM jsonb_populate_record(NULL::public.plan_discovery_venue_candidates,v_after) n WHERE t.id=n.id RETURNING to_jsonb(t) INTO v_saved;
      WHEN 'recommendations' THEN
        UPDATE public.recommendations t SET metadata=n.metadata,notes=n.notes,status=n.status,is_best_fit=n.is_best_fit
        FROM jsonb_populate_record(NULL::public.recommendations,v_after) n WHERE t.id=n.id RETURNING to_jsonb(t) INTO v_saved;
      WHEN 'plan_messages' THEN
        UPDATE public.plan_messages t SET metadata=n.metadata,content=n.content
        FROM jsonb_populate_record(NULL::public.plan_messages,v_after) n WHERE t.id=n.id RETURNING to_jsonb(t) INTO v_saved;
      WHEN 'agent_runs' THEN
        UPDATE public.agent_runs t SET input_payload=n.input_payload,output_payload=n.output_payload,
          messages_payload=n.messages_payload,raw_model_output=n.raw_model_output
        FROM jsonb_populate_record(NULL::public.agent_runs,v_after) n WHERE t.id=n.id RETURNING to_jsonb(t) INTO v_saved;
    END CASE;
    IF NOT FOUND OR encode(sha256(convert_to((v_saved-'updated_at')::TEXT,'UTF8')),'hex') IS DISTINCT FROM v_spec->>'posthash' THEN
      RAISE EXCEPTION 'legacy_venue_purge_postimage_mismatch' USING ERRCODE='22023',DETAIL=v_spec->>'id';
    END IF;
    v_changed := v_changed+1;
  END LOOP;
  SELECT jsonb_object_agg(relid::TEXT,jsonb_build_array(n_tup_ins,n_tup_upd,n_tup_del)) INTO v_stats_after
    FROM pg_stat_xact_user_tables WHERE NOT (schemaname='public' AND relname=ANY(v_tables));
  IF v_stats_after IS DISTINCT FROM v_stats THEN
    RAISE EXCEPTION 'legacy_venue_purge_protected_table_write' USING ERRCODE='22023';
  END IF;
  RAISE NOTICE 'legacy_venue_purge reviewed_rows=%, changed_rows=%',v_present,v_changed;
END;
$purge_reviewed_legacy_venue_content$;
