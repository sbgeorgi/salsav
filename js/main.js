document.addEventListener('DOMContentLoaded', function() {

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
        mobileToggle.addEventListener('click', () => {
            navbarLinks.classList.toggle('active');
        });

        // --- Dropdown Toggle on Mobile ---
        const dropdownToggles = navbarLinks.querySelectorAll('.has-dropdown > a');
        dropdownToggles.forEach(toggle => {
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
                        }
                    });
                    toggle.parentElement.classList.toggle('open');
                }
            });
        });
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
         document.querySelector('.navbar-menu a[href="#"]').classList.add('active');
    }
});