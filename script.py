# script.py (Final Version with Rate-Limiting Fix)

import os
import requests
import re
import urllib.parse
import time # <--- Import the time module

# This data is copied directly from your news.html's <script> tag.
news_items = [
    {'title': 'Agrivoltaics as a climate-smart and resilient solution for midday depression in photosynthesis in dryland regions', 'source': 'npj Sustainable Agriculture', 'description': 'SALSAv pilot demonstrated that partial shade eliminated midday photosynthesis slumps, giving equal or higher daily carbon uptake and yields across peppers, kale & beans.', 'date': '2025-06-05', 'url': 'https://www.nature.com/articles/s44264-025-00073-1', 'category': 'paper'},
    {'title': 'Exploring Crop Nutrients in Agrivoltaic Systems', 'source': 'UA CRFS Blog', 'description': 'SALSAv study shows PV-shade alters soil moisture & nutrient dynamics, with implications for produce quality.', 'date': '2025-04-15', 'url': 'https://crfs.arizona.edu/news/exploring-crop-nutrients-in-agrivoltaic-systems', 'category': 'article'},
    {'title': 'Growing Knowledge: U of A Researchers Share Findings at 2024 Agrivoltaics World Conference', 'source': 'Udall Center News', 'description': 'Conference recap—team reports physiological data showing crop heat-stress relief under PV arrays.', 'date': '2024-07-02', 'url': 'https://udallcenter.arizona.edu/news/uarizona-researchers-on-the-rise-at-2024-agrivoltaics-world-conference', 'category': 'article'},
    {'title': 'State of U.S. Agrivoltaics Deployment & Farmer’s Forum', 'source': 'Solar Farm Summit 2024 (YouTube)', 'description': 'NREL status update + farmer panel on scale-up hurdles, economics and labour safety in large PV farms.', 'date': '2024-03-25', 'url': 'https://www.youtube.com/watch?v=0K8-hHv9dpQ', 'category': 'video'},
    {'title': 'Trends, Insights, and Future Prospects for CEA & Agrivoltaics Systems (EIB-264)', 'source': 'USDA ERS', 'description': 'National outlook on investment, adoption rates and policy levers for controlled-environment ag and agrivoltaics.', 'date': '2024-01-15', 'url': 'https://www.ers.usda.gov/sites/default/files/_laserfiche/publications/108221/EIB-264.pdf', 'category': 'paper'},
    {'title': 'Biosphere 2 Agrivoltaics Walk-through', 'source': 'UArizona YouTube', 'description': 'Field tour of Biosphere 2 plots; explains instrumentation and crop responses under PV shade.', 'date': '2023-11-12', 'url': 'https://www.youtube.com/watch?v=PUmq1lTQJ98', 'category': 'video'},
    {'title': 'Knowns, uncertainties, and challenges in agrivoltaics to sustainably meet FEW goals', 'source': 'Curr. Opin. Env. Sustainability', 'description': 'Peer-reviewed meta-analysis highlighting UA/Biosphere-2 micro-climate & labor-safety datasets as highest-quality evidence; lists research gaps.', 'date': '2023-11-10', 'url': 'https://www.sciencedirect.com/science/article/pii/S2666386423003028', 'category': 'paper'},
    {'title': 'UArizona researchers awarded $1.2 M to explore farming at existing solar sites', 'source': 'UA News', 'description': 'DOE FARMS grant funds Barron-Gafford team to retrofit commercial PV farms for crop & grazing trials.', 'date': '2023-02-15', 'url': 'https://news.arizona.edu/news/uarizona-researchers-awarded-12m-explore-farming-existing-solar-power-sites', 'category': 'article'},
    {'title': 'WEBINAR: Made in the Shade – Growing Crops under Solar Panels', 'source': 'AgriSolar Clearinghouse', 'description': '45-min webinar where Dr. Barron-Gafford shares yield, water-use & panel-cooling data and best-practice tips.', 'date': '2023-02-20', 'url': 'https://attra.ncat.org/webinar-made-in-the-shade-growing-crops-under-solar-panels/', 'category': 'video'},
    {'title': 'The 5 Cs of Agrivoltaic Success Factors in the United States', 'source': 'NREL (Tech. Rep. 83566)', 'description': 'Synthesises lessons from 20+ InSPIRE sites into design rubric—Crops, Climates, Configuration, Constraints, Community—for developers & regulators.', 'date': '2022-08-01', 'url': 'https://www.nrel.gov/docs/fy22osti/83566.pdf', 'category': 'paper'},
    {'title': 'DOE SBIR Market-Research Study: Agrivoltaics', 'source': 'US DOE SETO', 'description': 'Maps federal SBIR/STTR funding flows and sizes the U.S. market; flags SALSAv as a “flagship semi-arid test-bed.”', 'date': '2022-08-01', 'url': 'https://science.osti.gov/-/media/sbir/pdf/Market-Research/SETO---Agrivoltaics-August-2022-Public.pdf', 'category': 'paper'},
    {'title': 'Growing Crops Under Solar Panels? Now There’s a Bright Idea', 'source': 'WIRED', 'description': 'Popular feature on Barron-Gafford’s “salsa garden” trials—up to 50 % water savings and cooler panels boosting efficiency.', 'date': '2021-10-14', 'url': 'https://www.wired.com/story/growing-crops-under-solar-panels-now-theres-a-bright-idea/', 'category': 'article'},
    {'title': 'Designing Agrivoltaics for Sustainably Intensifying Food & Energy Production', 'source': 'USDA-NIFA', 'description': 'Multi-institution (UI, CSU, UA) award building coupled PV–crop model validated at three solar farms, incl. SALSAv.', 'date': '2021-08-15', 'url': 'https://portal.nifa.usda.gov/web/crisprojectpages/1027532-designing-agrivoltaics-for-sustainably-intensifying-food-and-energy-production.html', 'category': 'article'},
    {'title': 'Agrivoltaics provide mutual benefits across the food–energy–water nexus in drylands', 'source': 'Nature Sustainability', 'description': 'Arizona field trial shows PV shade cut plant drought stress, boosted fruit yields and cooled panels, confirming the “win–win-win” food-water-energy model.', 'date': '2019-09-02', 'url': 'https://www.nature.com/articles/s41893-019-0364-5', 'category': 'paper'}
]

IMAGE_DIR = os.path.join('static', 'news-images')

def slugify(text):
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s-]+', '-', text).strip('-')
    return text

def download_all_images():
    if not os.path.exists(IMAGE_DIR):
        print(f"Creating directory: {IMAGE_DIR}")
        os.makedirs(IMAGE_DIR)

    # Use enumerate to track progress
    for i, item in enumerate(news_items):
        title_slug = slugify(item['title'])
        filename = f"{item['date']}-{title_slug[:50]}.jpg"
        image_path = os.path.join(IMAGE_DIR, filename)

        if os.path.exists(image_path):
            print(f"({i+1}/{len(news_items)}) Skipping, already exists: {image_path}")
            continue

        print(f"({i+1}/{len(news_items)}) Processing: '{item['title']}'")
        api_url = f"https://api.microlink.io/?url={urllib.parse.quote_plus(item['url'])}&screenshot=true"
        
        try:
            api_response = requests.get(api_url, timeout=30)
            api_response.raise_for_status()
            data = api_response.json()

            if data['status'] == 'success' and data['data'].get('image'):
                image_url = data['data']['image']['url']
                
                print(f"  -> Downloading from {image_url[:70]}...")
                image_response = requests.get(image_url, stream=True, timeout=30)
                image_response.raise_for_status()

                with open(image_path, 'wb') as f:
                    for chunk in image_response.iter_content(chunk_size=8192):
                        f.write(chunk)
                print(f"  -> SUCCESS: Saved to {image_path}")
            else:
                print(f"  -> API FAILED for '{item['title']}'. Reason: {data.get('message', 'No image found')}. No image saved.")

        except requests.exceptions.RequestException as e:
            print(f"  -> NETWORK ERROR for '{item['url']}': {e}. No image saved.")
        
        # --- THIS IS THE FIX ---
        # Add a 3-second delay to avoid hitting the API's rate limit.
        print("  -> Waiting for 3 seconds...")
        time.sleep(3)


    print("\n--- Image download process complete. ---")
    print(f"Check the '{IMAGE_DIR}' folder for the results.")

if __name__ == "__main__":
    download_all_images()