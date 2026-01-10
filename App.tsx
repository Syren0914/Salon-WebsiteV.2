import React from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Services from './components/Services';
import Machines from './components/Machines';
import About from './components/About';
import Owner from './components/Owner';
import Contact from './components/Contact';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-white overflow-x-hidden selection:bg-sage-200 selection:text-sage-900">
      <Navbar />
      <main>
        <Hero />
        <Services />
        <Machines />
        <About />
        <Owner />
        <Contact />
      </main>
    </div>
  );
};

export default App;