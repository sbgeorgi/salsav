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

*(Note: Each migration step involves copying the relevant HTML content from `index_old.html` into the new page's structure and adapting its style in `style.css`.)*

### 2.1: `index.html` (Homepage)
-   **Hero Section:** Create the hero from page 1 of the PDF, using text from the old hero.
-   **Intro Text:** Add a short "what is agrivoltaics" text.
-   **Research Areas Section:** Create the "Research Areas" section with three cards linking to anchors on `research.html`.

### 2.2: `research.html` (Research Page)
-   **Header:** Ensure "Research" link is active.
-   **Section 1: Ecophysiology (`#ecophysiology`):** Use layout from PDF pages 2/3. Migrate content about Biosphere 2.
-   **Section 2: Scaling Up (`#scaling-up`):** Use layout from PDF page 4. Migrate content about utility-scale projects (AES).
-   **Section 3: Scaling Out (`#scaling-out`):** Use layout from PDF page 5. Migrate content about global collaborations (Kenya, Israel, etc.).

### 2.3: `education.html` (Education Page)
-   **Header:** Ensure "Education" link is active.
-   **Layout & Content:** Use the design from PDF page 6. Create sections for the three programs.

### 2.4: `sites.html` (Sites Page)
-   **Header:** Ensure "Sites" link is active.
-   **REUSE FUNCTIONALITY:** Migrate the `<div id="map">` HTML and the entire Leaflet JavaScript logic into `js/main.js`. Ensure the interactive map works on this page. Adapt the legend styling to the new design.

### 2.5: `news.html` (News & Publications Page)
-   **Header:** Ensure "News" link is active.
-   **Layout:** Implement the filterable grid from PDF page 8.
-   **Interactivity:** Implement JS filter in `js/main.js`.

### 2.6: `team.html` (Team Page)
-   **Header:** Ensure "Team" link is active.
-   **MIGRATE ENTIRE SECTION:** Copy the entire `<section id="team-section">` from `index_old.html` (contributor cards and summary table) into this page and restyle.

### 2.7: `contact.html` (Contact Page)
-   **Header:** Ensure "Contact" link is active.
-   **Content:** Create a simple contact page using information from the old footer.

## Phase 3: Review and Refinement

1.  **Responsiveness:** Add media queries in `style.css` to ensure all pages are fully responsive on mobile and tablet.
2.  **Accessibility (A11y):** Review all content. Ensure images have `alt` tags, semantic HTML is used, and color contrast is sufficient.
3.  **Cross-linking:** Test all internal links, anchor links, map functionality, language toggle, and news filter.

## Phase 4: Repository Cleanup for Deployment

**Objective:** Finalize the repository, removing all temporary and backup files, leaving it in a clean state ready for GitHub Pages hosting.

1.  **Final Verification:** Double-check that all new HTML files (`index.html`, `research.html`, etc.) correctly link to `css/style.css` and `js/main.js`.
2.  **Delete Backup Files:** Delete the temporary backup files from the repository. Specifically, delete:
    -   `index_old.html`
    -   `css/old_styles.css`
3.  **Confirm Clean State:** The repository should now only contain the new, complete, and functional website files.
