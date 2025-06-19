        document.addEventListener('DOMContentLoaded', function () {

            const languageToggle = document.getElementById('languageToggle');
            let currentLanguage = localStorage.getItem('language') || 'en';

            function setLanguage(lang) {
                currentLanguage = lang;
                localStorage.setItem('language', lang);
                document.documentElement.lang = lang;

                if (lang === 'es') {
                    languageToggle.classList.add('toggle--on');
                    languageToggle.classList.remove('toggle--off');
                    languageToggle.setAttribute('aria-label', 'Cambiar idioma a Inglés');
                } else {
                    languageToggle.classList.remove('toggle--on');
                    languageToggle.classList.add('toggle--off');
                    languageToggle.setAttribute('aria-label', 'Toggle Language to Spanish');
                }
                updateContent();
                if (typeof updateMapLegendText === 'function') {
                    updateMapLegendText();
                }
            }

            function updateContent() {
                document.querySelectorAll('[data-en]').forEach(element => {
                    const englishText = element.getAttribute('data-en');
                    const spanishText = element.getAttribute('data-es');
                    
                    let newText;
                    if (currentLanguage === 'es' && spanishText) {
                        newText = spanishText;
                    } else {
                        newText = englishText;
                    }
                    
                    if (element.innerHTML !== newText) { 
                        element.innerHTML = newText;
                    }
                });
            }

            languageToggle.addEventListener('click', () => {
                setLanguage(currentLanguage === 'en' ? 'es' : 'en');
            });
            setLanguage(currentLanguage); 

            const navbar = document.querySelector('.navbar');
            const scrollThreshold = 50;
            function handleScroll() {
                if (window.scrollY > scrollThreshold) {
                    navbar.classList.add('scrolled');
                } else {
                    navbar.classList.remove('scrolled');
                }
            }
            window.addEventListener('scroll', handleScroll, { passive: true });
            handleScroll(); 

            const mobileToggle = document.querySelector('.mobile-toggle');
            const navbarLinks = document.querySelector('.navbar-links');
            mobileToggle.addEventListener('click', () => {
                const isExpanded = mobileToggle.getAttribute('aria-expanded') === 'true';
                mobileToggle.setAttribute('aria-expanded', !isExpanded);
                mobileToggle.classList.toggle('active');
                navbarLinks.classList.toggle('active');
            });

            navbarLinks.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => {
                    if (navbarLinks.classList.contains('active')) {
                        if (!link.parentElement.classList.contains('has-dropdown') || window.innerWidth >= 768) {
                             if (!link.closest('.dropdown-content')) { 
                                mobileToggle.setAttribute('aria-expanded', 'false');
                                mobileToggle.classList.remove('active');
                                navbarLinks.classList.remove('active');
                             }
                        }
                         if (link.closest('.dropdown-content')) { 
                            mobileToggle.setAttribute('aria-expanded', 'false');
                            mobileToggle.classList.remove('active');
                            navbarLinks.classList.remove('active');
                        }
                    }
                });
            });

            const dropdownToggles = navbarLinks.querySelectorAll('.has-dropdown > a');
            dropdownToggles.forEach(toggle => {
                toggle.addEventListener('click', (e) => {
                    if (window.innerWidth < 768) { 
                        e.preventDefault();
                        const parentLi = toggle.parentElement;
                        parentLi.classList.toggle('open');
                    }
                });
            });

            const revealElements = document.querySelectorAll('.reveal');
            const revealObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('active');
                    }
                });
            }, {
                threshold: 0.1, 
                rootMargin: '0px 0px -50px 0px' 
            });
            revealElements.forEach(el => {
                revealObserver.observe(el);
            });

            let map;
            let legend;

            function initializeMap() {
                const mapElement = document.getElementById('map');
                if (!mapElement) return;

                var initialZoom = window.innerWidth < 768 ? 2 : 3; 

                map = L.map('map').setView([20, 0], initialZoom); 

                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    attribution: 'Tiles © Esri',
                    maxZoom: 18
                }).addTo(map);

                function createRegionIcon(color, initial = '') {
                    const markerHtmlStyles = `
                  background-color: ${color};
                  width: 1.2rem;
                  height: 1.2rem;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  border-radius: 50%;
                  border: 2px solid #FFFFFF;
                  box-shadow: 0 0 0 1px ${color};
                  color: white;
                  font-size: 0.7rem;
                  font-weight: bold;
                  font-family: 'Inter', sans-serif;`;
                    return L.divIcon({
                        html: `<span style="${markerHtmlStyles}">${initial}</span>`,
                        className: 'custom-div-icon', 
                        iconSize: [20, 20], 
                        iconAnchor: [10, 10] 
                    });
                }

                var usaIcon = createRegionIcon('var(--primary-color, #CC0000)', 'US'); 
                var africaIcon = createRegionIcon('#228B22', 'AF'); 
                var middleEastIcon = createRegionIcon('#FFA500', 'ME'); 
                var latAmIcon = createRegionIcon('#007BFF', 'LA'); 


                const projectLocations = [
                    { name_en: "Biosphere 2 & AES Site", name_es: "Biosphere 2 y Sitio AES", coords: [32.5786, -110.8539], region_en: "Arizona, USA", region_es: "Arizona, EE.UU.", type: "USA", icon: usaIcon },
                    { name_en: "Jack’s Solar Garden (SCAPES)", name_es: "Jack’s Solar Garden (SCAPES)", coords: [40.1748, -105.1000], region_en: "Colorado, USA", region_es: "Colorado, EE.UU.", type: "USA", icon: usaIcon },
                    { name_en: "Makueni County Community Site", name_es: "Sitio Comunitario Condado Makueni", coords: [-2.2833, 37.7333], region_en: "Kenya", region_es: "Kenia", type: "Africa", icon: africaIcon },
                    { name_en: "Arava Desert Research", name_es: "Investigación Desierto de Arava", coords: [29.9000, 35.0000], region_en: "Israel", region_es: "Israel", type: "Middle East", icon: middleEastIcon },
                    { name_en: "Green Energy Park Collaboration", name_es: "Colaboración Green Energy Park", coords: [32.2345, -7.9448], region_en: "Morocco", region_es: "Marruecos", type: "Africa", icon: africaIcon },
                    { name_en: "PASE Project (UNAM)", name_es: "Proyecto PASE (UNAM)", coords: [19.3327, -99.1840], region_en: "Mexico", region_es: "México", type: "Latin America", icon: latAmIcon },
                    { name_en: "Sonora & Baja California Initiatives", name_es: "Iniciativas Sonora y Baja California", coords: [29.5, -111.0], region_en: "Northern Mexico", region_es: "Norte de México", type: "Latin America", icon: latAmIcon }
                ];

                projectLocations.forEach(function (location) {
                    let name_key = currentLanguage === 'es' ? location.name_es : location.name_en;
                    let region_key = currentLanguage === 'es' ? location.region_es : location.region_en;
                    let popup_region_label = currentLanguage === 'es' ? 'Región' : 'Region';


                    L.marker(location.coords, { icon: location.icon })
                        .addTo(map)
                        .bindPopup(`<strong>${name_key}</strong><br>${popup_region_label}: ${region_key}`);
                });

                legend = L.control({ position: 'bottomright' });
                legend.onAdd = function (map) {
                    const div = L.DomUtil.create('div', 'info legend leaflet-legend'); 
                    div.innerHTML = getLegendContent(); 
                    return div;
                };
                legend.addTo(map);
                
                window.updateMapLegendText = function () {
                    if (legend && map) {
                        const container = legend.getContainer();
                        if (container) {
                            container.innerHTML = getLegendContent();
                        }
                    }
                    const legendDiv = document.querySelector('.leaflet-legend');
                    if (legendDiv) {
                         legendDiv.querySelectorAll('[data-en]').forEach(el => {
                            const englishText = el.getAttribute('data-en');
                            const spanishText = el.getAttribute('data-es');
                            if (currentLanguage === 'es' && spanishText) {
                                el.textContent = spanishText;
                            } else {
                                el.textContent = englishText;
                            }
                        });
                        const strongTitle = legendDiv.querySelector('strong');
                        if(strongTitle) {
                            strongTitle.textContent = currentLanguage === 'es' ? 'Regiones Clave' : 'Key Regions';
                        }
                    }
                };


                function getLegendContent() {
                    const title = currentLanguage === 'es' ? 'Regiones Clave' : 'Key Regions';
                    return `
                  <strong>${title}</strong>
                  <div>
                      <span style="background-color:var(--primary-color, #CC0000); width:18px; height:18px; border-radius:50%; display:inline-block; margin-right:5px; text-align:center; color:white; font-size:0.7rem; line-height:18px; font-weight:bold;">US</span>
                      <span data-en="USA Sites" data-es="Sitios EE.UU.">${currentLanguage === 'es' ? "Sitios EE.UU." : "USA Sites"}</span>
                  </div>
                  <div>
                       <span style="background-color:#228B22; width:18px; height:18px; border-radius:50%; display:inline-block; margin-right:5px; text-align:center; color:white; font-size:0.7rem; line-height:18px; font-weight:bold;">AF</span>
                      <span data-en="Africa Sites" data-es="Sitios África">${currentLanguage === 'es' ? "Sitios África" : "Africa Sites"}</span>
                  </div>
                  <div>
                       <span style="background-color:#FFA500; width:18px; height:18px; border-radius:50%; display:inline-block; margin-right:5px; text-align:center; color:white; font-size:0.7rem; line-height:18px; font-weight:bold;">ME</span>
                      <span data-en="Middle East Sites" data-es="Sitios Medio Oriente">${currentLanguage === 'es' ? "Sitios Medio Oriente" : "Middle East Sites"}</span>
                  </div>
                  <div>
                      <span style="background-color:#007BFF; width:18px; height:18px; border-radius:50%; display:inline-block; margin-right:5px; text-align:center; color:white; font-size:0.7rem; line-height:18px; font-weight:bold;">LA</span>
                      <span data-en="Latin America Sites" data-es="Sitios América Latina">${currentLanguage === 'es' ? "Sitios América Latina" : "Latin America Sites"}</span>
                  </div>`;
                }


                fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json') 
                    .then(response => response.json())
                    .then(data => {
                        L.geoJSON(data, {
                            style: function (feature) {
                                return {
                                    'color': '#ccc', 
                                    'weight': 0.5,
                                    'opacity': 0.6,
                                    'fillOpacity': 0.05,
                                    'fillColor': '#e0e0e0' 
                                };
                            }
                        }).addTo(map);
                    })
                    .catch(error => console.error('Error loading GeoJSON:', error));

                let resizeTimeout;
                window.addEventListener('resize', function() {
                    clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(function() {
                        if (map) {
                            map.invalidateSize();
                        }
                    }, 250);
                });
                setTimeout(function () { if(map) map.invalidateSize(); }, 200);

            } 
            
            initializeMap();


            const tableContainer = document.querySelector('.table-container');
            const tableWrapper = document.querySelector('.table-scroll-wrapper');
            if (tableContainer && tableWrapper) {
                function checkScroll() {
                    if (!tableWrapper) return;
                    const hasHorizontalScroll = tableWrapper.scrollWidth > tableWrapper.clientWidth;
                    
                    const isAtEnd = tableWrapper.scrollLeft >= (tableWrapper.scrollWidth - tableWrapper.clientWidth - 5);

                    if (hasHorizontalScroll && !isAtEnd) {
                        tableContainer.classList.add('is-scrolling');
                    } else {
                        tableContainer.classList.remove('is-scrolling');
                    }
                }
                tableWrapper.addEventListener('scroll', checkScroll, { passive: true });
                window.addEventListener('resize', checkScroll);
                checkScroll(); 
            }
            
            document.querySelectorAll('.citation-link a').forEach(link => { 
                link.addEventListener('click', (e) => {
                    // Default behavior (opening link in new tab due to target='_blank') is fine
                });
            });

        });
