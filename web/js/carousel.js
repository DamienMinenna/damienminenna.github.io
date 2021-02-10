
$(document).ready(function(){
  $('.carousel').carousel();


// Or with jQuery

$('.carousel.carousel-slider').carousel({
  fullWidth: true,
  indicators: true
});

$('.moveNextCarousel').click(function(e){
        e.preventDefault();
        e.stopPropagation();
        $('.carousel').carousel('next');
   });

});
