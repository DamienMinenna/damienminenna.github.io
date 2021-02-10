var sections = document.getElementsByClassName('section');

window.addEventListener('mousewheel', function (e) {
    //console.log(e.deltaY > 0 ? 'down' : 'up');
    var nextSection = findNextSection(e.deltaY > 0);

    if (typeof nextSection !== 'undefined') {
        nextSection.scrollIntoView({
            behavior: "smooth",
            block: "start",
            inline: "nearest"
        });
        e.preventDefault();
    }
});

var findNextSection = function (down) {
    var sectionCount = sections.length;
    for (var i = 0 ; i < sectionCount ; i++) {
        if (down) {
            var bottomView = window.scrollY + window.innerHeight;
            if (bottomView > sections[i].offsetTop
                && (i === sectionCount - 1 || bottomView < sections[i + 1].offsetTop)) {
                return sections[i];
            }
        }
        if (!down) {
            var topView = window.scrollY;
            if (topView < sections[i].offsetTop + sections[i].offsetHeight
                && (i === 0 || topView > sections[i - 1].offsetTop + sections[i - 1].offsetHeight)) {
                return sections[i];
            }
        }
    }
}
