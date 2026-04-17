# 🌍 SmartAllocation: Data-Driven Volunteer Coordination
**Developer:** [yadavkrish18](https://github.com/yadavkrish18)

SmartAllocation is a powerful resource management system designed to bridge the gap between scattered community needs and coordinated volunteer action. [cite_start]By utilizing **AI semantic matching** and **real-time geospatial visualization**, the platform ensures that urgent local needs are met by the right people at the right time[cite: 1].

---

## 🚀 Key Features

* **AI-Powered Smart Search**: Volunteers describe skills in natural language (e.g., *"I have a truck for deliveries"*), and the system uses **Mistral AI Embeddings** to match them with relevant NGO needs.
* **Visual Urgency Dashboard**: An interactive map powered by **Leaflet.js** highlights urgent needs with a red pulsing "urgent-glow" animation.
* **Prioritized Matching**: Includes a **Seniority Boost** logic in the database that prioritizes older pending requests to ensure no community need is forgotten.
* **One-Click Commitment**: Volunteers can instantly commit to a task, which updates the database in real-time and removes the need from the map.
* **NGO Portal**: Dedicated interfaces for NGOs to register their organization and submit field reports or resource surveys.

---

## 🛠️ Tech Stack

* **Frontend**: HTML5, Tailwind CSS, JavaScript (Vanilla)
* **Mapping**: Leaflet.js
* **Backend/Database**: Supabase (PostgreSQL with `pgvector` extension)
* **AI Engine**: Mistral AI (Embeddings & Chat Completions)

---

## ⚙️ Setup Instructions

To protect sensitive information, this project uses a decoupled configuration system. **API keys are not stored in this repository.**

### 1. Clone the Repository
```bash
git clone [https://github.com/yadavkrish18/SmartAllocation.git](https://github.com/yadavkrish18/SmartAllocation.git)
cd SmartAllocation
```

### 2. Configure API Keys
1.  Locate `config.template.js` in the root directory.
2.  Create a copy of this file and rename it to **`config.js`**.
3.  Open `config.js` and enter your credentials:
    ```javascript
    window.CONFIG = {
      SUPABASE_URL: 'your-supabase-url',
      SUPABASE_ANON_KEY: 'your-supabase-anon-key',
      MISTRAL_API_KEY: 'your-mistral-api-key'
    };
    ```

### 3. Initialize the Database
Copy the contents of `schema.sql` and run it in your **Supabase SQL Editor**. This will:
* Create the `ngos` and `surveys` tables.
* Enable the `pgvector` extension and set up the `match_surveys` function for semantic matching.

---

## 🛡️ Security Note
This repository includes a `.gitignore` file that explicitly excludes `config.js` to prevent private API keys from being leaked. **Never remove `config.js` from your .gitignore.**

*Developed by yadavkrish18 — Focused on smarter resource allocation and social impact.*
```
