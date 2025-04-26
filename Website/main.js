// Dzovah main.js
// Dynamically load inspiration images into the gallery
const galleryImages = [
  'Branding/ref/t1.jpeg',
  'Branding/ref/t2.png',
  'Branding/ref/t3.png',
  'Branding/ref/t4.jpeg',
  'Branding/ref/t5.jpeg',
  'Branding/ref/t6.jpeg',
  'Branding/ref/t7.jpeg'
];

window.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.gallery-grid');
  if (grid) {
    galleryImages.forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = 'Inspiration';
      img.className = 'gallery-img';
      img.style.width = '100%';
      img.style.borderRadius = '10px';
      img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
      grid.appendChild(img);
    });
  }
});
