import React, { useState } from 'react';

function App() {
  const [url, setUrl] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [copiedCode, setCopiedCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setCodes([]);

    if (!url) {
      setError('Please enter a valid URL');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('http://localhost:3001/api/coupons', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch coupon codes');
      }

      if (Array.isArray(data)) {
        setCodes(data);
      } else if (data.error) {
        setError(data.error);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError('Failed to fetch coupon codes. Please try again.');
      }
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(''), 3000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-white">
      <header className="bg-[#010101] border-b border-[#262626] px-6 py-4">
        <h1 className="text-2xl font-bold tracking-wider text-white">Cotrix</h1>
      </header>

      <main className="flex-grow px-4 md:px-8 lg:px-16 py-8">
        <section className="mb-8 text-center">
          <h3 className="text-[#999] tracking-wider text-2xl">
            Enter a store URL to get the top 3 coupon codes
          </h3>
        </section>

        <section className="max-w-2xl mx-auto bg-[#0f0f0f] border border-[#262626] rounded p-6">
          <form onSubmit={handleSubmit} className="flex flex-row items-center gap-4">
            <label htmlFor="storeUrl" className="sr-only">
              Store URL
            </label>
            <input
              id="storeUrl"
              type="url"
              placeholder="https://www.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-10 flex-grow p-2 bg-[#141414] border border-[#262626] rounded focus:outline-none focus:border-[#b62779] hover:border-[#404040]"
              disabled={loading}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="h-10 px-6 bg-[#b62779] text-white rounded hover:opacity-90 transition-opacity text-sm font-semibold disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Find Coupons'}
            </button>
          </form>

          {error && (
            <div className="mt-4 text-red-500 text-center">
              {error}
            </div>
          )}

          {loading && (
            <div className="mt-8 text-center text-[#999]">
              Searching for coupon codes...
            </div>
          )}

          {!loading && codes.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg mb-4 tracking-wider">Best Coupon Codes Found</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {codes.map((code, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleCopyCode(code)}
                    className="group relative bg-[#141414] border border-[#262626] rounded p-6 text-center cursor-pointer hover:border-[#404040] transition-colors"
                  >
                    <h1 className="text-xl tracking-wider">{code}</h1>

                    {copiedCode !== code && (
                      <div className="absolute top-1 right-1 flex items-center gap-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity delay-100">
                        <svg
                          width="14"
                          height="14"
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
                      <div className="absolute top-1 right-1 flex items-center gap-1 text-xs text-white">
                        <svg
                          aria-label="Verified"
                          width="18"
                          height="18"
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
                        <span className="text-xs">Copied</span>
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
        &copy; {new Date().getFullYear()} Cotrix. All rights reserved.
      </footer>
    </div>
  );
}

export default App;