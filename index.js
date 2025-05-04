import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Configuration
dotenv.config();

// Express setup
const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Extract locations from natural language query
const extractLocations = (query) => {
  try {
      // More robust regex patterns
      const patterns = [
          // Pattern 1: "from X to Y"
          {
              from: /(?:from)\s+([^,]+?)(?=\s+to\b)/i,
              to: /(?:to)\s+([^,\?\.]+)/i
          },
          // Pattern 2: "X to Y"
          {
              from: /^([^,]+?)(?=\s+to\b)/i,
              to: /to\s+([^,\?\.]+)/i
          }
      ];

      let fromMatch, toMatch;

      // Try each pattern until we find a match
      for (const pattern of patterns) {
          fromMatch = query.match(pattern.from);
          toMatch = query.match(pattern.to);
          
          if (fromMatch?.[1] && toMatch?.[1]) {
              break;
          }
      }

      if (!fromMatch?.[1] || !toMatch?.[1]) {
          throw new Error('Could not identify locations in the query');
      }

      const locations = {
          from: fromMatch[1].trim(),
          to: toMatch[1].trim()
      };

      // Validate extracted locations
      if (locations.from === locations.to) {
          throw new Error('Start and end locations appear to be the same');
      }

      console.log('📍 Extracted locations:', locations);
      return locations;
  } catch (err) {
      console.error('Location extraction error:', err);
      throw new Error('Could not understand the locations. Please try "How\'s traffic from X to Y?"');
  }
};

// Main route handler
app.post("/traffic", async (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ 
            error: "Please ask a question about traffic" 
        });
    }

    try {
        console.log('🔍 Processing query:', query);
        const locations = extractLocations(query);
        console.log('📍 Extracted locations:', locations);
        
        const trafficData = await getTrafficInfo(locations.from, locations.to);
        const response = getAIResponse(locations.from, locations.to, trafficData);
        res.json({ reply: response });
    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ 
            error: "I couldn't understand that. Please try asking in a different way.",
            details: err.message 
        });
    }
});

// Location coordinates retrieval using Google Maps
const getCoordinates = async (location) => {
    try {
        const cleanLocation = location.replace(/\s+/g, ' ').trim();
        const searchLocation = cleanLocation.toLowerCase().includes('tbilisi') 
            ? cleanLocation 
            : `${cleanLocation}, Tbilisi, Georgia`;
        
        console.log('🔍 Searching location:', searchLocation);

        const searchUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchLocation)}&key=${process.env.GOOGLE_MAPS_KEY}&region=ge`;
        
        const response = await fetch(searchUrl);
        const data = await response.json();

        if (data.status !== 'OK' || !data.results?.[0]) {
            throw new Error(`Location not found: ${searchLocation}`);
        }

        const result = data.results[0];
        console.log('📍 Found location:', result.formatted_address);

        return {
            lat: result.geometry.location.lat,
            lon: result.geometry.location.lng,
            name: result.formatted_address
        };
    } catch (err) {
        console.error(`❌ Geocoding error:`, err);
        throw new Error(`Cannot find location: ${location}`);
    }
};

// Traffic information retrieval using Google Maps
const getTrafficInfo = async (from, to) => {
  try {
      const fromCoords = await getCoordinates(from);
      const toCoords = await getCoordinates(to);
      
      // Add timestamp for real-time traffic
      const timestamp = Math.floor(Date.now() / 1000);
      const routeUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(fromCoords.name)}&destination=${encodeURIComponent(toCoords.name)}&key=${process.env.GOOGLE_MAPS_KEY}&departure_time=${timestamp}&language=en&region=ge&traffic_model=best_guess&mode=driving&alternatives=true`;
      
      console.log('🚗 Fetching route...');
      const routeResponse = await fetch(routeUrl);
      const routeData = await routeResponse.json();

      if (routeData.status !== 'OK' || !routeData.routes?.[0]) {
          throw new Error('No route found between these locations');
      }

      const route = routeData.routes[0].legs[0];
      const distance = (route.distance.value / 1000).toFixed(1);
      
      // Removed minimum distance check and improved validation
      if (!route.steps || route.steps.length === 0) {
          throw new Error('No route steps found');
      }

      // Get meaningful steps (filter out very short segments)
      const significantSteps = route.steps.filter(step => 
          step.distance.value > 50 && // Changed to 50m for better accuracy
          !step.html_instructions.toLowerCase().includes('destination')
      );
      
      const mainStreet = significantSteps[0]?.html_instructions?.replace(/<[^>]*>/g, '') || 'Direct route';
      const nextStep = significantSteps[1]?.html_instructions?.replace(/<[^>]*>/g, '');
      
      const travelTime = Math.ceil(route.duration_in_traffic?.value / 60 || route.duration.value / 60);
      const normalTime = Math.ceil(route.duration.value / 60);
      const trafficDelay = Math.max(0, travelTime - normalTime);

      let response = `Route Summary:\n`;
      response += `From: ${route.start_address}\n`;
      response += `To: ${route.end_address}\n`;
      response += `Via: ${mainStreet}\n`;
      if (nextStep) {
          response += `Next: ${nextStep}\n`;
      }
      response += `Distance: ${distance} km\n`;
      response += trafficDelay > 0 
          ? `⚠️ Traffic delay: ${trafficDelay} minutes\n` 
          : `✅ No traffic delays\n`;
      response += `Total travel time: ${travelTime} minutes\n`;

      return response;
  } catch (err) {
      console.error('❌ Route error:', err);
      throw err;
  }
};

// Format response
const getAIResponse = (from, to, trafficFact) => {
    try {
        const timeMatch = trafficFact.match(/Total travel time: (\d+)/);
        const distanceMatch = trafficFact.match(/Distance: ([\d.]+)/);
        const viaMatch = trafficFact.match(/Via: (.*?)\n/);
        const directionsMatch = trafficFact.match(/Directions: (.*?)\n/);

        if (!timeMatch || !distanceMatch) {
            throw new Error('Missing route information');
        }

        const time = timeMatch[1];
        const distance = distanceMatch[1];
        const street = viaMatch ? viaMatch[1].trim() : '';
        const directions = directionsMatch ? directionsMatch[1].trim() : '';
        const hasDelay = trafficFact.includes('⚠️ Traffic delay');
        
        let response = `🚗 Here's the route information:\n\n`;
        
        if (street) {
            response += `📍 Take ${street}\n`;
            if (directions) {
                response += `↪️ ${directions}\n`;
            }
        }
        
        if (hasDelay) {
            const delayMatch = trafficFact.match(/Traffic delay: (\d+)/);
            const delay = delayMatch ? delayMatch[1] : '0';
            response += `⚠️ There's a ${delay}-minute delay on this route.\n`;
        } else {
            response += `✅ Roads are clear! No traffic delays.\n`;
        }
        
        response += `🛣️ Distance: ${distance} km\n`;
        response += `⏱️ Estimated travel time: ${time} minutes\n`;

        return response;
    } catch (err) {
        console.error('❌ Format error:', err);
        return trafficFact;
    }
};

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚦 TrafficAI running on http://localhost:${PORT}`));