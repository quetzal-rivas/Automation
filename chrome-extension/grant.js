document.getElementById('grant-btn').addEventListener('click', async () => {
  const btn = document.getElementById('grant-btn');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    
    btn.innerText = '¡Permiso Concedido!';
    btn.style.background = '#22c55e';
    
    setTimeout(() => {
        window.close();
    }, 1500);
  } catch (e) {
    btn.innerText = 'Error al pedir permiso';
    btn.style.background = '#ef4444';
  }
});
