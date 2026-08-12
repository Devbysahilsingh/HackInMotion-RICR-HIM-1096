# Agricultural Terminology Layer (`agri` namespace)

Curated en↔hi table; single source for every crop, disease, stage, soil, action term. Draft entries below marked ✓ = common established usage, ? = verify with Hindi-literate teammate + agri glossaries (ICAR/DD Kisan usage) before demo. THIS TABLE REQUIRES HUMAN SIGN-OFF (team-plan task).

## Crops
Rice धान ✓ · Wheat गेहूँ ✓ · Maize मक्का ✓ · Cotton कपास ✓ · Tomato टमाटर ✓ · Potato आलू ✓ · Onion प्याज ✓ · Chilli मिर्च ✓ · Soybean सोयाबीन ✓

## Stages
Sowing बुवाई ✓ · Initial अंकुरण/प्रारंभिक ? · Development बढ़वार ? · Mid/Flowering फूल आना ✓ · Late/Maturity पकना ✓ · Harvest कटाई ✓

## Diseases (sample; full table with every mlClassCode)
Early blight अगेती झुलसा ✓ · Late blight पछेती झुलसा ✓ · Blast (rice) ब्लास्ट/झोंका ? · Brown spot भूरा धब्बा ✓ · Leaf curl virus पत्ती मोड़क रोग ? · Bacterial blight जीवाणु झुलसा ✓ · Rust रतुआ ✓ · Mosaic virus मोज़ेक विषाणु ? · Healthy स्वस्थ ✓

## Soils
Alluvial जलोढ़ ✓ · Black काली (रेगुर) ✓ · Red लाल ✓ · Laterite लैटेराइट ? · Sandy बलुई ✓ · Loamy दोमट ✓ · Clay चिकनी ✓

## Core actions/concepts
Irrigation सिंचाई ✓ · Fertilizer खाद/उर्वरक ✓ · Soil test मिट्टी जांच ✓ · Mandi price मंडी भाव ✓ · Quintal क्विंटल ✓ · Weather मौसम ✓ · Rain बारिश/वर्षा ✓ · Frost पाला ✓ · Heat wave लू ✓ · Alert चेतावनी ✓ · Recommendation सलाह ✓

Rules: disease keys always `agri:disease.{CODE}`; UI never concatenates terminology fragments (grammar breaks) — full sentence keys with interpolation; regional synonyms recorded as `altNames` for voice-keyword matching reuse (shared with voice-intents constants).
