document.addEventListener('DOMContentLoaded', function () {
    var elems = document.querySelectorAll('.scrollspy');
    var instances = M.ScrollSpy.init(elems, {
        'scrollOffset': 50
    });
});
