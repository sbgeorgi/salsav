# SALSA Agrivoltaics Website Redesign - Project Plan

## Phase 0: Project Setup & Asset Preparation

**Objective:** Establish a clean, modern file structure and prepare existing assets for migration.

1.  **Backup Old Site:** Rename `index.html` to `index_old.html`. This file is now your primary source for content and code snippets.
2.  **Create New HTML Files:** Create the following empty HTML files in the root directory, corresponding to the new navigation structure:
    -   `index.html` (Homepage)
    -   `research.html`
    -   `education.html`
    -   `sites.html`
    -   `news.html`
    -   `team.html`
    -   `contact.html`
3.  **Organize CSS:**
    -   Inside the `css/` folder, create a new file named `style.css`.
    -   Rename the existing `css/main-styles.css` to `css/old_styles.css` for reference.
4.  **Organize JS:** Create a new folder named `js/`. Inside it, create `main.js`. We will migrate JavaScript logic here from `index_old.html`.
5.  **Organize Assets:**
    -   Create an `assets/` folder.
    -   Move the existing `static/` folder *inside* `assets/`, so the path becomes `assets/static/`. Update image paths accordingly during development.
    -   Extract any new images from `SALSAV-Webdesign.pdf` and save them in a new `assets/images/` folder.

## Phase 1: Global Elements (Header, Footer, and Base Styles)

**Objective:** Create the reusable components and foundational styles by adapting them from `index_old.html`.

1.  **HTML Boilerplate:** Populate all new HTML files with a standard HTML5 boilerplate. Link to `css/style.css` and `js/main.js`.
2.  **Header and Navigation:**
    -   In each HTML file, create a `<header>` and `<nav>` structure similar to the new design.
    -   The `<nav>` will contain an unordered list (`<ul>`) of links: Home, Research, Education, Sites, News, Team, Contact.
    -   The link for the current page must have an `class="active"` to be styled with the circle highlight from the PDF.
    -   **MIGRATE:** Port the language toggle switch HTML and its associated JavaScript logic from `index_old.html` into the new header structure and `js/main.js`.
3.  **Footer:**
    -   **MIGRATE:** Re-create the footer from `index_old.html` in every new HTML file. It contains valuable links and contact information. Ensure the styles are adapted in `style.css`.
4.  **Base CSS (`style.css`):**
    -   **ADAPT:** Open `css/old_styles.css` and `index_old.html`'s `<style>` block.
    -   Copy the root color variables, font imports (`Inter`, `Source Sans 3`), and body styles into the new `style.css`.
    -   Style the new header, navigation (including the `.active` circle), and footer.
    -   Create utility classes (`.container`, `.button`, etc.) based on the old styles.

## Phase 2: Page-by-Page Content Migration & Implementation

**Objective:** Build out each page, prioritizing the migration of existing content from `index_old.html` and matching the layout from `SALSAV-Webdesign.pdf`.

### 2.1: `index.html` (Homepage)

1.  **Hero Section:** Create the hero section from page 1 of the PDF. Use the text from the old hero section.
2.  **Intro Text:** Add a short "what is agrivoltaics" text as shown in the PDF.
3.  **Research Areas Section:**
    -   Create the "Research Areas" section with three cards as per the PDF design.
    -   The cards ("Ecophysiology", "Scaling Up", "Scaling Out") must link to anchor tags on the new `research.html` page (e.g., `research.html#ecophysiology`).

### 2.2: `research.html` (Research Page)

*Note: This page is a consolidation of pages 2-5 of the PDF and will heavily use content from `index_old.html`'s detailed site sections.*

1.  **Header:** Ensure the "Research" link is active.
2.  **Section 1: Ecophysiology (`<section id="ecophysiology">`)**
    -   Use the layout from page 2/3 of the PDF (hero image, blurb, diagram).
    -   **MIGRATE:** For the "Projects & Sites" and "Outputs" subsections, find the relevant content (e.g., text about Biosphere 2) from the `id="arizona-sites-detailed"` section in `index_old.html` and place it here.
3.  **Section 2: Scaling Up (`<section id="scaling-up">`)**
    -   Use the layout from page 4 of the PDF. Rebuild the 2x2 diagram with CSS.
    -   **MIGRATE:** Populate this section with relevant text from `index_old.html` concerning utility-scale projects (e.g., the AES site description).
4.  **Section 3: Scaling Out (`<section id="scaling-out">`)**
    -   Use the layout from page 5 of the PDF. Rebuild the "Agrivoltaics Living Labs" infographic.
    -   **MIGRATE:** Populate this section with text about the global collaborations (Kenya, Israel, Morocco, Mexico) from the corresponding detailed sections in `index_old.html`.

### 2.3: `education.html` (Education Page)

1.  **Header:** Ensure "Education" link is active.
2.  **Layout:** Use the design from page 6 of the PDF.
3.  **Content:** Create sections for "School Garden Program," "Global School of Agrivoltaics," and "Interdisciplinary Opportunities." Use existing team members like Caleb Ortega who are involved in school gardens to populate content.

### 2.4: `sites.html` (Sites Page)

1.  **Header:** Ensure "Sites" link is active.
2.  **Map Section:**
    -   **REUSE FUNCTIONALITY:** Do NOT use a static image.
    -   Migrate the HTML `<div id="map"></div>` from `index_old.html`.
    -   Migrate the entire Leaflet JavaScript logic from the `<script>` tag in `index_old.html` into `js/main.js`.
    -   Ensure the map is initialized correctly on this page. Adapt the legend styling to match the new PDF design (page 7).

### 2.5: `news.html` (News & Publications Page)

1.  **Header:** Ensure "News" link is active.
2.  **Layout:** Implement the filterable grid from page 8 of the PDF.
3.  **Content:** Create card components for "Paper", "Video", and "Article". Populate with the publication thumbnails from page 3 of the PDF as examples.
4.  **Interactivity:** Implement a simple JavaScript filter in `js/main.js` that shows/hides cards based on a `data-type` attribute.

### 2.6: `team.html` (Team Page)

1.  **Header:** Ensure "Team" link is active.
2.  **MIGRATE ENTIRE SECTION:**
    -   Find the `<section id="team-section">` in `index_old.html`.
    -   Copy the entire "Key Contributors" grid of researcher cards and the "Team Summary" table into `team.html`.
    -   Adapt the styling in `style.css` to match the new site's aesthetic while preserving the layout.

### 2.7: `contact.html` (Contact Page)

1.  **Header:** Ensure "Contact" link is active.
2.  **Content:** Create a simple contact page. Use the contact information already present in the footer of `index_old.html`. You may add a simple contact form.

## Phase 3: Finalization & Review

1.  **Responsiveness:** Add media queries in `style.css` to ensure all pages, especially the migrated map and team grid, are fully responsive.
2.  **Accessibility (A11y):** Review all migrated and new content. Ensure images have `alt` tags, semantic HTML is used, and color contrast is sufficient.
3.  **Code Cleanup:** Consolidate all JS into `main.js`. Clean up `style.css`, removing any redundant selectors from the migration.
4.  **Final Check:** Test all internal links, the map functionality, the language toggle, and the news filter.

