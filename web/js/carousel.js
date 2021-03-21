$(window).resize(function(){location.reload();});


$(document).ready(function(){
  $('.carousel').carousel();


// Or with jQuery

$('.carousel.carousel-slider').carousel({
  fullWidth: true,
  indicators: true,
  height : 1800,
});

autoplay()
function autoplay() {
    $('.carousel').carousel('next');
    setTimeout(autoplay, 4500);
}

$('.moveNextCarousel').click(function(e){
        e.preventDefault();
        e.stopPropagation();
        $('.carousel').carousel('next');
   });

});
