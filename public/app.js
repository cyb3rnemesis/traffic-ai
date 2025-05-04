document.addEventListener('DOMContentLoaded', () => {
    const queryInput = document.getElementById('query');
    const searchBtn = document.getElementById('searchBtn');
    const resultBox = document.getElementById('result');

    const getTrafficInfo = async () => {
        const query = queryInput.value.trim();

        if (!query) {
            alert('Please enter your question');
            return;
        }

        try {
            searchBtn.disabled = true;
            searchBtn.textContent = 'Loading...';
            resultBox.classList.remove('active');
            
            const response = await fetch('/traffic', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query })
            });

            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }

            resultBox.textContent = data.reply;
            resultBox.classList.add('active');
        } catch (error) {
            console.error('Error:', error);
            resultBox.textContent = 'Sorry, something went wrong. Please try again.';
            resultBox.classList.add('active');
        } finally {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Get Route';
        }
    };

    // Button click handler
    searchBtn.addEventListener('click', getTrafficInfo);

    // Enter key handler
    queryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !searchBtn.disabled) {
            getTrafficInfo();
        }
    });
});