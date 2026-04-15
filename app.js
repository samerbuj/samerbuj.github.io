// --- IMPORT FIREBASE MODULAR SDK ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { 
    getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy 
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

// --- INITIALIZE FIREBASE ---
const app = initializeApp(window.CONFIG.FIREBASE_CONFIG);
const db = getFirestore(app);

// --- DYNAMICALLY LOAD GOOGLE MAPS ---
function loadGoogleMaps() {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${window.CONFIG.GOOGLE_MAPS_API_KEY}&libraries=places&callback=initMap`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

// --- GLOBAL VARIABLES ---
let map;
let markers = [];
let currentPlaceData = null; 
let activeSearchMarker = null; 
let globalInfoWindow; 
let currentReviewId = null; 
let globalHistory = []; 

const breadIconURL = `data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="35" height="35"><text x="0" y="28" font-size="28">🥖</text></svg>`;

// --- FETCH DATA FROM FIREBASE ---
async function fetchReviews() {
    try {
        const q = query(collection(db, "bmo_reviews"), orderBy("date", "desc"));
        const snapshot = await getDocs(q);
        globalHistory = snapshot.docs.map(docSnapshot => ({
            id: docSnapshot.id, 
            ...docSnapshot.data()
        }));
        renderHistoryAndPins();
    } catch (error) {
        console.error("Error fetching reviews: ", error);
    }
}

// --- UI NAVIGATION LOGIC ---
window.showHome = function() {
    document.getElementById('homeView').classList.add('active');
    document.getElementById('formView').classList.remove('active');
    document.getElementById('detailView').classList.remove('active');
    document.getElementById('cafeSearch').value = ''; 
    currentPlaceData = null;
    currentReviewId = null; 
}

window.cancelReview = function() {
    if (activeSearchMarker) activeSearchMarker.setMap(null); 
    window.showHome();
    map.setZoom(13); 
}

window.closeDetail = function() {
    globalInfoWindow.close(); 
    window.showHome();
    map.setZoom(13);
}

function showForm(placeData) {
    currentReviewId = null; 
    document.getElementById('homeView').classList.remove('active');
    document.getElementById('formView').classList.add('active');
    document.getElementById('detailView').classList.remove('active');
    
    document.getElementById('formCafeName').innerText = placeData.name;
    document.getElementById('reviewDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('formGoogleRating').innerText = `🌍 Google Rating: ${placeData.googleRating} / 5`;
    document.getElementById('reviewComment').value = '';
    
    const photoGallery = document.getElementById('formPhotos');
    photoGallery.innerHTML = '';
    if (placeData.photos && placeData.photos.length > 0) {
        placeData.photos.forEach(url => photoGallery.innerHTML += `<img src="${url}" alt="Cafe photo">`);
    } else {
        photoGallery.innerHTML = '<span style="font-size: 0.8em; color: #888;">No photos available</span>';
    }
    
    categories.forEach(cat => {
        document.getElementById(`${cat.id}-p1`).value = '';
        document.getElementById(`${cat.id}-p2`).value = '';
    });
    document.getElementById('hadCoffee').checked = false;
    window.toggleCoffee();
}

function showDetail(review) {
    currentReviewId = review.id; 
    
    document.getElementById('homeView').classList.remove('active');
    document.getElementById('formView').classList.remove('active');
    document.getElementById('detailView').classList.add('active');
    
    document.getElementById('detailName').innerText = review.cafe;
    
    const dateObj = new Date(review.date);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('detailDate').innerText = dateObj.toLocaleDateString(undefined, options);
    
    document.getElementById('detailScore').innerText = review.score;
    
    const coffeeScoreEl = document.getElementById('detailCoffeeScore');
    if (review.scoreWithCoffee) {
        coffeeScoreEl.style.display = 'block';
        coffeeScoreEl.innerHTML = `With Coffee: <span>${review.scoreWithCoffee}</span>/10 ☕`;
    } else {
        coffeeScoreEl.style.display = 'none';
    }
    
    document.getElementById('detailComparison').innerText = `🌍 Google Users gave it: ${review.googleRating || 'N/A'}/5`;

    const commentSection = document.getElementById('detailCommentSection');
    if (review.comment && review.comment.trim() !== "") {
        commentSection.style.display = 'block';
        document.getElementById('detailCommentText').innerText = review.comment;
    } else {
        commentSection.style.display = 'none';
    }

    const detailPhotos = document.getElementById('detailPhotos');
    detailPhotos.innerHTML = '';
    if (review.photos && review.photos.length > 0) {
        review.photos.forEach(url => detailPhotos.innerHTML += `<img src="${url}" alt="Cafe photo">`);
    } else {
        detailPhotos.innerHTML = '<span style="font-size: 0.8em; color: #888;">No photos saved for this trip.</span>';
    }
}

// --- EDIT & DELETE LOGIC ---
window.deleteReview = async function() {
    if(confirm("Are you sure you want to delete this review? 🥺")) {
        try {
            await deleteDoc(doc(db, "bmo_reviews", currentReviewId));
            window.closeDetail();
            fetchReviews(); 
        } catch (error) {
            console.error("Error deleting document: ", error);
            alert("Failed to delete.");
        }
    }
}

window.openEditForm = function() {
    const review = globalHistory.find(r => r.id === currentReviewId);
    
    currentPlaceData = {
        name: review.cafe,
        lat: review.lat,
        lng: review.lng,
        googleRating: review.googleRating,
        photos: review.photos
    };
    
    document.getElementById('homeView').classList.remove('active');
    document.getElementById('detailView').classList.remove('active');
    document.getElementById('formView').classList.add('active');
    
    document.getElementById('formCafeName').innerText = review.cafe;
    document.getElementById('reviewDate').value = review.date;
    document.getElementById('formGoogleRating').innerText = `🌍 Google Rating: ${review.googleRating || 'N/A'} / 5`;
    document.getElementById('reviewComment').value = review.comment || '';
    
    const photoGallery = document.getElementById('formPhotos');
    photoGallery.innerHTML = '';
    if (review.photos && review.photos.length > 0) {
        review.photos.forEach(url => photoGallery.innerHTML += `<img src="${url}" alt="Cafe photo">`);
    }
    
    const hadCoffee = review.rawScores && review.rawScores['coffee'];
    document.getElementById('hadCoffee').checked = !!hadCoffee;
    window.toggleCoffee();
    
    categories.forEach(cat => {
        if (review.rawScores && review.rawScores[cat.id]) {
            document.getElementById(`${cat.id}-p1`).value = review.rawScores[cat.id].p1;
            document.getElementById(`${cat.id}-p2`).value = review.rawScores[cat.id].p2;
        } else {
            document.getElementById(`${cat.id}-p1`).value = '';
            document.getElementById(`${cat.id}-p2`).value = '';
        }
    });
}

// --- FORM GENERATION LOGIC ---
const categories = [
    { id: 'bread', icon: '🥖', name: 'The Bread' },
    { id: 'cheese', icon: '🧀', name: 'The Cheese' },
    { id: 'place', icon: '🪴', name: 'The Place / Vibe' },
    { id: 'price', icon: '💸', name: 'Price / Value' },
    { id: 'coffee', icon: '☕', name: 'The Coffee' } 
];

document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById('categoriesContainer');
    categories.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'category-card';
        div.id = `card-${cat.id}`;

        if (cat.id === 'coffee') {
            div.innerHTML = `
                <div class="coffee-toggle">
                    <input type="checkbox" id="hadCoffee" onchange="toggleCoffee()">
                    <label for="hadCoffee" style="margin:0; cursor: pointer; font-size: 1.1em; width: 100%;">${cat.icon} We had coffee here!</label>
                </div>
                <div class="coffee-collapsible" id="coffee-collapsible">
                    <div class="coffee-collapsible-inner">
                        <div style="height: 15px;"></div>
                        <div class="rating-row" style="margin-bottom: 0;">
                            <div class="rating-input"><label>Samer</label><input type="number" id="${cat.id}-p1" min="1" max="10" placeholder="Score"></div>
                            <div class="rating-input"><label>Matilde</label><input type="number" id="${cat.id}-p2" min="1" max="10" placeholder="Score"></div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            div.innerHTML = `
                <div class="category-header"><span>${cat.icon} ${cat.name}</span></div>
                <div class="rating-row" style="margin-bottom: 0;">
                    <div class="rating-input"><label>Samer</label><input type="number" id="${cat.id}-p1" min="1" max="10" placeholder="Score"></div>
                    <div class="rating-input"><label>Matilde</label><input type="number" id="${cat.id}-p2" min="1" max="10" placeholder="Score"></div>
                </div>
            `;
        }
        container.appendChild(div);
    });
    
    loadGoogleMaps();
    fetchReviews(); 
});

window.toggleCoffee = function() {
    const isChecked = document.getElementById('hadCoffee').checked;
    const collapsible = document.getElementById('coffee-collapsible');
    if (isChecked) {
        collapsible.classList.add('open');
    } else {
        collapsible.classList.remove('open');
    }
}

// --- MAP & INIT LOGIC ---
window.initMap = function() {
    const copenhagen = { lat: 55.6761, lng: 12.5683 };
    
    map = new google.maps.Map(document.getElementById("map"), {
        zoom: 13,
        center: copenhagen,
        mapId: "DEMO_MAP_ID",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
    });

    globalInfoWindow = new google.maps.InfoWindow();
    const input = document.getElementById("cafeSearch");
    const autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo("bounds", map);
    autocomplete.setFields(["geometry", "name", "rating", "photos"]);

    autocomplete.addListener("place_changed", () => {
        globalInfoWindow.close();
        const place = autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;

        let extractedPhotos = [];
        if (place.photos) {
            extractedPhotos = place.photos.slice(0, 10).map(photo => photo.getUrl({maxWidth: 400}));
        }

        currentPlaceData = {
            name: place.name,
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            googleRating: place.rating || "N/A",
            photos: extractedPhotos
        };

        map.setCenter(place.geometry.location);
        map.setZoom(16);
        
        if (activeSearchMarker) activeSearchMarker.setMap(null);
        activeSearchMarker = new google.maps.Marker({
            map: map,
            position: place.geometry.location,
            animation: google.maps.Animation.DROP,
            icon: breadIconURL
        });

        showForm(currentPlaceData);
    });
};

// --- SAVE TO FIREBASE ---
window.calculateAndSave = async function() {
    if (!currentPlaceData) return;

    let coreSum = 0;
    let coreCount = 0;
    let coffeeSum = 0;
    
    const hadCoffee = document.getElementById('hadCoffee').checked;
    const selectedDate = document.getElementById('reviewDate').value; 
    const commentText = document.getElementById('reviewComment').value;
    const rawScores = {}; 

    categories.forEach(cat => {
        const p1Str = document.getElementById(`${cat.id}-p1`).value;
        const p2Str = document.getElementById(`${cat.id}-p2`).value;
        
        if (cat.id === 'coffee' && (!hadCoffee || (p1Str === '' && p2Str === ''))) return;

        const p1 = parseFloat(p1Str) || 0;
        const p2 = parseFloat(p2Str) || 0;
        
        rawScores[cat.id] = { p1, p2 }; 
        const catAvg = (p1 + p2) / 2;

        if (cat.id === 'coffee') {
            coffeeSum = catAvg; 
        } else {
            coreSum += catAvg; 
            coreCount++;
        }
    });

    const finalScore = (coreCount > 0) ? (coreSum / coreCount).toFixed(1) : 0;
    
    let finalScoreWithCoffee = null;
    if (hadCoffee && rawScores['coffee']) {
        finalScoreWithCoffee = ((coreSum + coffeeSum) / (coreCount + 1)).toFixed(1);
    }

    const review = { 
        cafe: currentPlaceData.name, 
        lat: currentPlaceData.lat,
        lng: currentPlaceData.lng,
        date: selectedDate, 
        score: finalScore, 
        scoreWithCoffee: finalScoreWithCoffee, 
        hadCoffee: hadCoffee,
        googleRating: currentPlaceData.googleRating, 
        photos: currentPlaceData.photos,
        rawScores: rawScores,
        comment: commentText 
    };

    try {
        if (currentReviewId !== null) {
            await updateDoc(doc(db, "bmo_reviews", currentReviewId), review);
        } else {
            await addDoc(collection(db, "bmo_reviews"), review);
        }
        
        if (activeSearchMarker) activeSearchMarker.setMap(null);
        window.showHome();
        map.setZoom(14);
        fetchReviews(); 

    } catch (error) {
        console.error("Error saving document: ", error);
        alert("Failed to save review to the cloud.");
    }
}

// --- RENDER FROM CLOUD DATA ---
function renderHistoryAndPins() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    
    markers.forEach(marker => marker.setMap(null));
    markers = [];

    globalHistory.forEach((item) => { 
        const div = document.createElement('div');
        div.className = 'history-item';
        const dateStr = new Date(item.date).toLocaleDateString();
        
        let extraScoreHtml = item.scoreWithCoffee ? `<br><span style="color: var(--secondary); font-size: 0.9em;">☕ With Coffee: ${item.scoreWithCoffee}/10</span>` : '';
        
        div.innerHTML = `
            <strong>${item.cafe}</strong> <br>
            <span style="color: var(--secondary); font-size: 0.9em;">${dateStr}</span> <br>
            ✨ <strong>Score: ${item.score}/10</strong> ${extraScoreHtml}
        `;
        
        let currentMarker = null;

        if (item.lat && item.lng && map) {
            currentMarker = new google.maps.Marker({
                position: { lat: item.lat, lng: item.lng },
                map: map,
                title: item.cafe,
                animation: google.maps.Animation.DROP,
                icon: breadIconURL 
            });
            
            let infoCoffeeStr = item.scoreWithCoffee ? `<br>☕: ${item.scoreWithCoffee}` : '';
            
            currentMarker.addListener("click", () => {
                showDetail(item); 
                map.setCenter(currentMarker.getPosition());
                globalInfoWindow.setContent(`<div style="font-family:'Quicksand'; padding:5px; text-align:center;"><strong>${item.cafe}</strong><br>Our ⭐: ${item.score} ${infoCoffeeStr} | Google ⭐: ${item.googleRating || 'N/A'}</div>`);
                globalInfoWindow.open(map, currentMarker);
            });

            markers.push(currentMarker);
        }

        div.onclick = () => {
            showDetail(item); 
            if (item.lat && item.lng && currentMarker) {
                map.setCenter({lat: item.lat, lng: item.lng});
                map.setZoom(16);
                globalInfoWindow.setContent(`<div style="font-family:'Quicksand'; padding:5px; text-align:center;"><strong>${item.cafe}</strong><br>Our ⭐: ${item.score} | Google ⭐: ${item.googleRating || 'N/A'}</div>`);
                globalInfoWindow.open(map, currentMarker);
            }
        };
        
        list.appendChild(div);
    });
}