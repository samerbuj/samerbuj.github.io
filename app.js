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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${window.CONFIG.GOOGLE_MAPS_API_KEY}&libraries=places&loading=async&callback=initMap`;
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

// State Tracking
let currentReviewId = null; 
let currentWishlistId = null; 
let convertingWishlistId = null; 
let globalHistory = []; 
let globalWishlist = [];
let currentCustomPhotos = []; 

const breadIconURL = `data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="35" height="35"><text x="0" y="28" font-size="28">🥖</text></svg>`;
const pinIconURL = `data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="35" height="35"><text x="0" y="28" font-size="28">📌</text></svg>`;

// --- FETCH DATA FROM FIREBASE ---
async function fetchAllData() {
    try {
        const qHistory = query(collection(db, "bmo_reviews"), orderBy("date", "desc"));
        const snapHistory = await getDocs(qHistory);
        globalHistory = snapHistory.docs.map(d => ({ id: d.id, ...d.data() }));

        const qWish = query(collection(db, "bmo_wishlist"), orderBy("addedAt", "desc"));
        const snapWish = await getDocs(qWish);
        globalWishlist = snapWish.docs.map(d => ({ id: d.id, ...d.data() }));

        renderHistoryAndPins();
    } catch (error) {
        console.error("Error fetching data: ", error);
    }
}

// --- NEW: LIGHTBOX LOGIC ---
window.openImageModal = function(src) {
    document.getElementById('expandedImg').src = src;
    document.getElementById('imageModal').style.display = 'flex';
}

window.closeImageModal = function() {
    document.getElementById('imageModal').style.display = 'none';
}

// --- IMAGE COMPRESSOR & UPLOADER ---
function compressImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                // BUMPED RESOLUTION: 1080px max (looks great on phones/web)
                const MAX_SIZE = 1080; 
                let width = img.width;
                let height = img.height;

                if (width > height && width > MAX_SIZE) {
                    height *= MAX_SIZE / width;
                    width = MAX_SIZE;
                } else if (height > MAX_SIZE) {
                    width *= MAX_SIZE / height;
                    height = MAX_SIZE;
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // BUMPED QUALITY: 80% JPEG
                resolve(canvas.toDataURL('image/jpeg', 0.8)); 
            }
        }
    });
}

window.handlePhotoUpload = async function(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const preview = document.getElementById('customPhotoPreview');
    // Just append a loading message so it doesn't delete the existing preview thumbnails
    preview.innerHTML += '<span id="loadingMsg" style="font-size: 0.85em; color: var(--primary); margin-left: 10px;">Compressing... ⏳</span>';
    
    // Notice we removed `currentCustomPhotos = [];`! It now appends.

    for (let file of files) {
        const compressedBase64 = await compressImage(file);
        currentCustomPhotos.push(compressedBase64);
    }
    
    event.target.value = ''; // Reset the file input so you can select the same file again if needed
    renderCustomPhotoPreview();
}

window.removeCustomPhoto = function(index) {
    // Remove the specific photo from the array
    currentCustomPhotos.splice(index, 1);
    renderCustomPhotoPreview();
}

function renderCustomPhotoPreview() {
    const preview = document.getElementById('customPhotoPreview');
    preview.innerHTML = '';
    currentCustomPhotos.forEach((src, index) => {
        preview.innerHTML += `
            <div class="preview-img-container">
                <img src="${src}" alt="Our photo preview" onclick="openImageModal(this.src)">
                <button class="delete-photo-btn" onclick="removeCustomPhoto(${index})" title="Remove photo">✕</button>
            </div>
        `;
    });
}

// --- DYNAMIC PHOTO LOADER ---
function loadFreshPhotos(placeId, containerId, fallbackPhotos) {
    const gallery = document.getElementById(containerId);
    gallery.innerHTML = '<span style="font-size: 0.8em; color: #888;">Loading fresh photos... ⏳</span>';

    if (placeId && map) {
        const service = new google.maps.places.PlacesService(map);
        service.getDetails({ placeId: placeId, fields: ['photos'] }, (place, status) => {
            gallery.innerHTML = '';
            if (status === google.maps.places.PlacesServiceStatus.OK && place.photos && place.photos.length > 0) {
                place.photos.slice(0, 10).forEach(photo => {
                    // NEW: Changed to maxWidth 800 and added onclick
                    gallery.innerHTML += `<img src="${photo.getUrl({maxWidth: 800})}" alt="Cafe photo" onclick="openImageModal(this.src)">`;
                });
            } else if (fallbackPhotos && fallbackPhotos.length > 0) {
                // NEW: Added onclick
                fallbackPhotos.forEach(url => gallery.innerHTML += `<img src="${url}" alt="Cafe photo" onclick="openImageModal(this.src)">`);
            } else {
                gallery.innerHTML = '<span style="font-size: 0.8em; color: #888;">No photos available.</span>';
            }
        });
    } else if (fallbackPhotos && fallbackPhotos.length > 0) {
        gallery.innerHTML = '';
        // NEW: Added onclick
        fallbackPhotos.forEach(url => gallery.innerHTML += `<img src="${url}" alt="Cafe photo" onclick="openImageModal(this.src)">`);
    } else {
        gallery.innerHTML = '<span style="font-size: 0.8em; color: #888;">No photos available.</span>';
    }
}

// --- UI NAVIGATION & VIEW MANAGEMENT ---
function hideAllViews() {
    document.getElementById('homeView').classList.remove('active');
    document.getElementById('formView').classList.remove('active');
    document.getElementById('detailView').classList.remove('active');
    document.getElementById('choiceView').classList.remove('active');
    document.getElementById('wishlistDetailView').classList.remove('active');
}

window.showHome = function() {
    hideAllViews();
    document.getElementById('homeView').classList.add('active');
    document.getElementById('cafeSearch').value = ''; 
    currentPlaceData = null;
    currentReviewId = null; 
    currentWishlistId = null;
}

window.cancelReview = function() {
    if (activeSearchMarker) activeSearchMarker.setMap(null); 
    convertingWishlistId = null;
    window.showHome();
    if(map) map.setZoom(13); 
}

window.closeDetail = function() {
    if(globalInfoWindow) globalInfoWindow.close(); 
    window.showHome();
    if(map) map.setZoom(13);
}

window.showChoice = function(placeData) {
    hideAllViews();
    document.getElementById('choiceView').classList.add('active');
    
    document.getElementById('choiceCafeName').innerText = placeData.name;
    document.getElementById('choiceGoogleRating').innerText = `🌍 Google Rating: ${placeData.googleRating} / 5`;
    
    loadFreshPhotos(placeData.placeId, 'choicePhotos', placeData.photos);
}

window.proceedToReview = function() {
    showForm(currentPlaceData);
}

function showForm(placeData) {
    currentReviewId = null; 
    hideAllViews();
    document.getElementById('formView').classList.add('active');
    
    document.getElementById('formCafeName').innerText = placeData.name;
    document.getElementById('reviewDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('formGoogleRating').innerText = `🌍 Google Rating: ${placeData.googleRating} / 5`;
    document.getElementById('reviewComment').value = '';
    
    currentCustomPhotos = [];
    document.getElementById('photoUpload').value = '';
    document.getElementById('customPhotoPreview').innerHTML = '';
    
    loadFreshPhotos(placeData.placeId, 'formPhotos', placeData.photos);
    
    categories.forEach(cat => {
        document.getElementById(`${cat.id}-p1`).value = '';
        document.getElementById(`${cat.id}-p2`).value = '';
    });
    document.getElementById('hadCoffee').checked = false;
    window.toggleCoffee();
}

window.showDetail = function(review) {
    currentReviewId = review.id; 
    
    hideAllViews();
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
    if (review.customPhotos && review.customPhotos.length > 0) {
        detailPhotos.innerHTML = '';
        // NEW: Added onclick
        review.customPhotos.forEach(url => detailPhotos.innerHTML += `<img src="${url}" alt="Our photo" onclick="openImageModal(this.src)">`);
    } else {
        loadFreshPhotos(review.placeId, 'detailPhotos', review.photos);
    }
}

window.showWishlistDetail = function(item) {
    currentWishlistId = item.id;
    hideAllViews();
    document.getElementById('wishlistDetailView').classList.add('active');
    
    document.getElementById('wishlistDetailName').innerText = item.cafe;
    
    loadFreshPhotos(item.placeId, 'wishlistDetailPhotos', item.photos);
}

// --- SAVE AND DELETE LOGIC ---
window.saveToWishlist = async function() {
    if (!currentPlaceData) return;
    
    const wishItem = {
        cafe: currentPlaceData.name,
        placeId: currentPlaceData.placeId, 
        lat: currentPlaceData.lat,
        lng: currentPlaceData.lng,
        googleRating: currentPlaceData.googleRating,
        photos: currentPlaceData.photos,
        addedAt: new Date().toISOString()
    };

    try {
        await addDoc(collection(db, "bmo_wishlist"), wishItem);
        if (activeSearchMarker) activeSearchMarker.setMap(null);
        window.showHome();
        if(map) map.setZoom(14);
        fetchAllData(); 
    } catch (error) {
        console.error("Error saving to wishlist: ", error);
        alert("Failed to save.");
    }
}

window.convertWishlistToReview = function() {
    const item = globalWishlist.find(w => w.id === currentWishlistId);
    currentPlaceData = {
        name: item.cafe,
        placeId: item.placeId,
        lat: item.lat,
        lng: item.lng,
        googleRating: item.googleRating,
        photos: item.photos
    };
    convertingWishlistId = currentWishlistId; 
    showForm(currentPlaceData);
}

window.deleteWishlistItem = async function() {
    if(confirm("Remove this from your Want To Go list?")) {
        try {
            await deleteDoc(doc(db, "bmo_wishlist", currentWishlistId));
            window.closeDetail();
            fetchAllData(); 
        } catch (error) {
            console.error("Error deleting: ", error);
        }
    }
}

window.deleteReview = async function() {
    if(confirm("Are you sure you want to delete this review? 🥺")) {
        try {
            await deleteDoc(doc(db, "bmo_reviews", currentReviewId));
            window.closeDetail();
            fetchAllData(); 
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
        placeId: review.placeId, 
        lat: review.lat,
        lng: review.lng,
        googleRating: review.googleRating,
        photos: review.photos
    };
    
    hideAllViews();
    document.getElementById('formView').classList.add('active');
    
    document.getElementById('formCafeName').innerText = review.cafe;
    document.getElementById('reviewDate').value = review.date;
    document.getElementById('formGoogleRating').innerText = `🌍 Google Rating: ${review.googleRating || 'N/A'} / 5`;
    document.getElementById('reviewComment').value = review.comment || '';
    
    loadFreshPhotos(review.placeId, 'formPhotos', review.photos);
    
    currentCustomPhotos = review.customPhotos ? [...review.customPhotos] : [];
    document.getElementById('photoUpload').value = ''; 
    renderCustomPhotoPreview();
    
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
    fetchAllData(); 
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

    function forceDropdownMatch() {
        const rect = input.getBoundingClientRect();
        document.documentElement.style.setProperty('--search-width', `${rect.width}px`);
        document.documentElement.style.setProperty('--search-left', `${rect.left}px`);
    }
    // Re-measure if the user resizes the window or clicks the search bar
    window.addEventListener('resize', forceDropdownMatch);
    input.addEventListener('input', forceDropdownMatch);
    input.addEventListener('focus', forceDropdownMatch);
    forceDropdownMatch(); // Run once immediately to set it up

    const autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo("bounds", map);
    autocomplete.setFields(["geometry", "name", "rating", "photos", "place_id"]);

    autocomplete.addListener("place_changed", () => {
        globalInfoWindow.close();
        const place = autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;

        let extractedPhotos = [];
        if (place.photos) {
            // NEW: Fetch max width 800px so it's clear when expanded
            extractedPhotos = place.photos.slice(0, 10).map(photo => photo.getUrl({maxWidth: 800}));
        }

        currentPlaceData = {
            name: place.name,
            placeId: place.place_id, 
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

        window.showChoice(currentPlaceData);
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
        placeId: currentPlaceData.placeId, 
        lat: currentPlaceData.lat,
        lng: currentPlaceData.lng,
        date: selectedDate, 
        score: finalScore, 
        scoreWithCoffee: finalScoreWithCoffee, 
        hadCoffee: hadCoffee,
        googleRating: currentPlaceData.googleRating, 
        photos: currentPlaceData.photos,
        rawScores: rawScores,
        comment: commentText,
        customPhotos: currentCustomPhotos 
    };

    try {
        if (currentReviewId !== null) {
            await updateDoc(doc(db, "bmo_reviews", currentReviewId), review);
        } else {
            await addDoc(collection(db, "bmo_reviews"), review);
            
            if (convertingWishlistId) {
                await deleteDoc(doc(db, "bmo_wishlist", convertingWishlistId));
                convertingWishlistId = null; 
            }
        }
        
        if (activeSearchMarker) activeSearchMarker.setMap(null);
        window.showHome();
        map.setZoom(14);
        fetchAllData(); 

    } catch (error) {
        console.error("Error saving document: ", error);
        alert("Failed to save review to the cloud.");
    }
}

// --- RENDER FROM CLOUD DATA ---
function renderHistoryAndPins() {
    document.getElementById('wishlistList').innerHTML = '';
    document.getElementById('historyList').innerHTML = '';
    
    markers.forEach(marker => marker.setMap(null));
    markers = [];

    // Render Wishlist
    globalWishlist.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `<strong>${item.cafe}</strong> <br> <span style="color: var(--secondary); font-size: 0.9em;">📌 Want To Go</span>`;
        
        let currentMarker = null;

        if (item.lat && item.lng && map) {
            currentMarker = new google.maps.Marker({
                position: { lat: item.lat, lng: item.lng },
                map: map,
                title: item.cafe,
                icon: pinIconURL 
            });
            
            currentMarker.addListener("click", () => {
                window.showWishlistDetail(item); 
                map.setCenter(currentMarker.getPosition());
                globalInfoWindow.setContent(`<div style="font-family:'Quicksand'; padding:5px; text-align:center;"><strong>${item.cafe}</strong><br>📌 Want to go</div>`);
                globalInfoWindow.open(map, currentMarker);
            });
            markers.push(currentMarker);
        }

        div.onclick = () => {
            window.showWishlistDetail(item); 
            if (item.lat && item.lng && currentMarker) {
                map.setCenter({lat: item.lat, lng: item.lng});
                map.setZoom(16);
                globalInfoWindow.setContent(`<div style="font-family:'Quicksand'; padding:5px; text-align:center;"><strong>${item.cafe}</strong><br>📌 Want to go</div>`);
                globalInfoWindow.open(map, currentMarker);
            }
        };
        document.getElementById('wishlistList').appendChild(div);
    });

    // Render Past Adventures
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
                window.showDetail(item); 
                map.setCenter(currentMarker.getPosition());
                globalInfoWindow.setContent(`<div style="font-family:'Quicksand'; padding:5px; text-align:center;"><strong>${item.cafe}</strong><br>Our ⭐: ${item.score} ${infoCoffeeStr} | Google ⭐: ${item.googleRating || 'N/A'}</div>`);
                globalInfoWindow.open(map, currentMarker);
            });

            markers.push(currentMarker);
        }

        div.onclick = () => {
            window.showDetail(item); 
            if (item.lat && item.lng && currentMarker) {
                map.setCenter({lat: item.lat, lng: item.lng});
                map.setZoom(16);
                globalInfoWindow.setContent(`<div style="font-family:'Quicksand'; padding:5px; text-align:center;"><strong>${item.cafe}</strong><br>Our ⭐: ${item.score} | Google ⭐: ${item.googleRating || 'N/A'}</div>`);
                globalInfoWindow.open(map, currentMarker);
            }
        };
        
        document.getElementById('historyList').appendChild(div);
    });
}