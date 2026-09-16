const frame=document.querySelector('#phone-frame');
frame.src='./'+location.hash;
document.querySelector('#full-link').href='./'+location.hash;
history.replaceState(null,'',location.pathname);
document.querySelector('#small-width').addEventListener('click',()=>document.querySelector('.phone').style.width='395px');
document.querySelector('#large-width').addEventListener('click',()=>document.querySelector('.phone').style.width='450px');
