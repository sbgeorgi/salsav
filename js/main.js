document.addEventListener('DOMContentLoaded', function() {
    document.body.removeAttribute('data-nav-open');

    // --- Navbar Scroll Effect ---
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        const scrollThreshold = 20;
        const handleScroll = () => {
            if (window.scrollY > scrollThreshold) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
    }

    // --- Mobile Navigation Toggle ---
    const mobileToggle = document.querySelector('.mobile-toggle');
    const navbarLinks = document.querySelector('.navbar-links');

    if (mobileToggle && navbarLinks) {
        const dropdownToggles = navbarLinks.querySelectorAll('.has-dropdown > a');
        const setMenuState = (isOpen) => {
            navbarLinks.classList.toggle('active', isOpen);
            mobileToggle.setAttribute('aria-expanded', String(isOpen));
            if (isOpen) {
                document.body.dataset.navOpen = 'true';
            } else {
                document.body.removeAttribute('data-nav-open');
            }
            if (!isOpen) {
                dropdownToggles.forEach(toggle => {
                    toggle.parentElement.classList.remove('open');
                    toggle.setAttribute('aria-expanded', 'false');
                });
            }
        };

        if (!navbarLinks.id) {
            navbarLinks.id = 'navbar-links';
        }
        mobileToggle.setAttribute('aria-controls', navbarLinks.id);
        mobileToggle.setAttribute('aria-expanded', 'false');
        mobileToggle.addEventListener('click', () => {
            setMenuState(!navbarLinks.classList.contains('active'));
        });

        // --- Dropdown Toggle on Mobile ---
        dropdownToggles.forEach(toggle => {
            toggle.setAttribute('aria-expanded', 'false');
            toggle.addEventListener('click', (e) => {
                if (window.innerWidth < 992) {
                    // Prevent navigation on first click to open dropdown
                    if (!toggle.parentElement.classList.contains('open')) {
                        e.preventDefault();
                    }
                    // Close other open dropdowns
                    dropdownToggles.forEach(otherToggle => {
                        if (otherToggle !== toggle) {
                            otherToggle.parentElement.classList.remove('open');
                            otherToggle.setAttribute('aria-expanded', 'false');
                        }
                    });
                    toggle.parentElement.classList.toggle('open');
                    toggle.setAttribute('aria-expanded', String(toggle.parentElement.classList.contains('open')));
                }
            });
        });

        navbarLinks.querySelectorAll('.navbar-menu a').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth < 992 && !link.parentElement.classList.contains('has-dropdown')) {
                    setMenuState(false);
                }
            });
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                setMenuState(false);
            }
        });

        window.addEventListener('pagehide', () => setMenuState(false));

        window.addEventListener('resize', () => {
            if (window.innerWidth >= 992) {
                setMenuState(false);
            }
        }, { passive: true });
    }

    // --- Active Nav Link Highlighter ---
    const currentLocation = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('.navbar-menu a');

    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href').split('/').pop();

        // Exact match for pages
        if (linkPath === currentLocation) {
            link.classList.add('active');
            const parentDropdown = link.closest('.has-dropdown');
            if (parentDropdown) {
                parentDropdown.querySelector('a').classList.add('active');
            }
        }
    });

    // Special case for research landing page
    if (currentLocation.startsWith('research-')) {
         document.querySelector('.navbar-menu a[href="#"]')?.classList.add('active');
    }
});
