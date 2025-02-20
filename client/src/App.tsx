import React, { useState } from 'react';

const API_URL = process.env.NODE_ENV === 'production' 
  ? '/api/coupons'
  : 'http://localhost:3001/api/coupons';

function App() {
  const [url, setUrl] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function formatUrl(input: string): string {
    // Remove any existing protocol
    let cleanUrl = input.replace(/^(https?:\/\/)?(www\.)?/, '');
    
    // If they paste a full URL, preserve the protocol they used
    if (input.startsWith('http://')) {
      return `http://${cleanUrl}`;
    }
    
    // Default to https://
    return `https://${cleanUrl}`;
  }

  function updateUrl(newValue: string) {
    // Only auto-format if there's content and it contains a '.'
    if (newValue && newValue.includes('.')) {
      setUrl(formatUrl(newValue));
    } else {
      setUrl(newValue);
    }
  }

  function doSearch() {
    if (!url) {
      setError('Please enter a URL');
      return;
    }

    setLoading(true);
    setError('');
    setCodes([]);

    let isCancelled = false;

    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        if (isCancelled) return;
        console.log('Received data from server:', data);
        if (Array.isArray(data)) {
          setCodes(data);
        } else if (data.error) {
          setError(data.error);
        } else {
          setError('Unexpected response format');
        }
      })
      .catch(err => {
        if (isCancelled) return;
        setError(err.message || 'Failed to fetch codes');
        console.error('Fetch error:', err);
      })
      .finally(() => {
        if (isCancelled) return;
        setLoading(false);
      });

    return () => { isCancelled = true; };
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(''), 2000);
  }

  return (
    <div className="flex flex-col min-h-screen bg-black text-white">
      <header className="bg-[#010101] border-b border-[#262626] px-4 sm:px-6 py-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-wider text-white">Cotrix</h1>
      </header>

      <main className="flex-grow px-4 py-6 sm:px-8 lg:px-16 sm:py-8">
        <section className="mb-6 sm:mb-8 text-center">
          <h3 className="text-xl sm:text-2xl text-[#999] tracking-wider px-2">
            Enter a store URL to get the top coupon code
          </h3>
        </section>

        <section className="max-w-2xl mx-auto bg-[#0f0f0f] border border-[#262626] rounded p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
            <input
              type="text"
              placeholder="example.com"
              value={url}
              onChange={e => updateUrl(e.target.value)}
              className="h-12 sm:h-10 flex-grow p-3 sm:p-2 bg-[#141414] border border-[#262626] rounded text-base focus:outline-none focus:border-[#b62779] hover:border-[#404040]"
              disabled={loading}
            />
            <button
              onClick={() => doSearch()}
              disabled={loading}
              className="h-12 sm:h-10 px-6 bg-[#b62779] text-white rounded hover:opacity-90 transition-opacity text-base sm:text-sm font-semibold disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Find Coupons'}
            </button>
          </div>

          {error && (
            <div className="mt-4 text-red-500 text-center">
              {error}
            </div>
          )}

          {loading && (
            <div className="mt-6 sm:mt-8 text-center text-[#999]">
              Searching for coupon code...
            </div>
          )}

          {!loading && codes.length > 0 && (
            <div className="mt-6 sm:mt-8">
              <h2 className="text-lg mb-4 tracking-wider">Best coupon code found</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                {codes.map((code, idx) => (
                  <button
                    key={idx}
                    onClick={() => copyCode(code)}
                    className="group relative bg-[#141414] border border-[#262626] rounded p-6 text-center cursor-pointer hover:border-[#404040] transition-colors min-h-[80px] flex items-center justify-center"
                  >
                    <h1 className="text-lg sm:text-md tracking-wider">{code}</h1>

                    {copiedCode !== code && (
                      <div className="absolute top-2 right-2 flex items-center gap-1 text-sm sm:text-xs text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity delay-100">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="icon-xs"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M7 5C7 3.34315 8.34315 2 10 2H19C20.6569 2 22 3.34315 22 5V14C22 15.6569 20.6569 17 19 17H17V19C17 20.6569 15.6569 22 14 22H5C3.34315 22 2 20.6569 2 19V10C2 8.34315 3.34315 7 5 7H7V5ZM9 7H14C15.6569 7 17 8.34315 17 10V15H19C19.5523 15 20 14.5523 20 14V5C20 4.44772 19.5523 4 19 4H10C9.44772 4 9 4.44772 9 5V7ZM5 9C4.44772 9 4 9.44772 4 10V19C4 19.5523 4.44772 20 5 20H14C14.5523 20 15 19.5523 15 19V10C15 9.44772 14.5523 9 14 9H5Z"
                            fill="currentColor"
                          />
                        </svg>
                        <span>Copy</span>
                      </div>
                    )}

                    {copiedCode === code && (
                      <div className="absolute top-2 right-2 flex items-center gap-1 text-sm sm:text-xs text-white">
                        <svg
                          aria-label="Verified"
                          width="20"
                          height="20"
                          viewBox="0 -960 960 960"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="shrink-0"
                        >
                          <path
                            d="m344-60-76-128-144-32 14-148-98-112 98-112-14-148 144-32 76-128 136 58 136-58 76 128 144 32-14 148 98 112-98 112 14 148-144 32-76 128-136-58-136 58Z"
                            fill="#b62779"
                          />
                          <path
                            d="M438-338 L664-564 L608-622 L438-452 L352-538 L296-482 L438-338 Z"
                            fill="#ffffff"
                          />
                        </svg>
                        <span>Copied</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="mt-auto bg-[#010101] border-t border-[#262626] py-4 text-center text-[#A1A1A1] text-sm">
        © 2025 Cotrix. All rights reserved.
      </footer>
    </div>
  );
}

export default App;