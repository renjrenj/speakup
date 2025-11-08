import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged 
} from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    doc, 
    setDoc, 
    onSnapshot, 
    query,
    serverTimestamp,
    deleteDoc,
    where 
} from 'firebase/firestore';

// Global variables provided by the environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- UTILITY FUNCTIONS ---
// Function to convert HIXM-XXXXXX-XXXXXX-XXXX into a clean, queryable key
const normalizeCIN = (cin) => cin.toUpperCase().replace(/[^A-Z0-9]/g, '');

// --- STYLING CONSTANTS (Based on User's Color Scheme) ---
const COLORS = {
    primary: '#004d99', // Deep Blue
    secondary: '#DAA520', // Goldenrod
    accent: '#800000', // Rich Maroon/Dark Red
    background: '#f0f4f8',
    cardBg: '#ffffff',
    text: '#333333',
};

// --- REACT COMPONENT ---
const App = () => {
    // Firebase State
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    // Application State
    const [registry, setRegistry] = useState([]);
    const [cinInput, setCinInput] = useState('');
    const [ownerNameInput, setOwnerNameInput] = useState('');
    const [ssssInput, setSsssInput] = useState(''); // STATE FOR SSSS
    const [searchQuery, setSearchQuery] = useState('');
    const [lookupResult, setLookupResult] = useState(null);
    const [message, setMessage] = useState('');
    const [isEditing, setIsEditing] = useState(false);

    // 1. FIREBASE INITIALIZATION AND AUTHENTICATION
    useEffect(() => {
        if (!firebaseConfig) {
            console.error("Firebase config is missing.");
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firestoreAuth = getAuth(app);

            setDb(firestoreDb);
            setAuth(firestoreAuth);

            // Authentication listener
            const unsubscribe = onAuthStateChanged(firestoreAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    setIsAuthReady(true);
                } else {
                    // Try to sign in with custom token or anonymously
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(firestoreAuth, initialAuthToken);
                        } else {
                            await signInAnonymously(firestoreAuth);
                        }
                    } catch (error) {
                        console.error("Authentication failed:", error);
                        setIsAuthReady(true); // Still set ready, but userId will be null
                    }
                }
            });

            return () => unsubscribe();
        } catch (error) {
            console.error("Firebase initialization failed:", error);
        }
    }, []);

    // 2. REAL-TIME DATA LISTENER (FIRESTORE)
    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        // Path for private internal data: /artifacts/{appId}/users/{userId}/cin_registry
        const registryCollectionRef = collection(db, 'artifacts', appId, 'users', userId, 'cin_registry');
        
        // Listen to the collection for real-time updates
        const unsubscribe = onSnapshot(query(registryCollectionRef), (snapshot) => {
            const updatedRegistry = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sort in memory by CIN (as firestore orderBy requires indexes which can be complex)
            updatedRegistry.sort((a, b) => a.cin.localeCompare(b.cin));
            setRegistry(updatedRegistry);
        }, (error) => {
            console.error("Firestore snapshot error:", error);
            setMessage(`Error fetching registry data: ${error.message}`);
        });

        return () => unsubscribe();
    }, [isAuthReady, db, userId]);
    
    // --- DATA MANAGEMENT HANDLERS ---
    
    const handleClearForm = () => {
        setCinInput('');
        setOwnerNameInput('');
        setSsssInput(''); // CLEAR SSSS INPUT
        setIsEditing(false);
    };

    const handleEditEntry = (entry) => {
        setCinInput(entry.cin);
        setOwnerNameInput(entry.ownerName);
        setSsssInput(entry.ssss || ''); // LOAD SSSS FOR EDITING
        setIsEditing(true);
        setMessage('');
    };

    const handleSaveEntry = async (e) => {
        e.preventDefault();
        
        if (!db || !userId) {
            setMessage('Error: Registry connection not ready.');
            return;
        }

        const normalizedCin = normalizeCIN(cinInput);
        const name = ownerNameInput.trim();
        const ssss = ssssInput.trim(); // GET SSSS VALUE

        if (normalizedCin.length < 16 || name.length === 0 || ssss.length === 0) {
            setMessage('All fields (CIN, Owner Name, SSSS) must be complete.');
            return;
        }

        try {
            // Use the normalized CIN as the document ID for easy lookup and uniqueness enforcement
            const docRef = doc(db, 'artifacts', appId, 'users', userId, 'cin_registry', normalizedCin);
            
            await setDoc(docRef, {
                cin: normalizedCin,
                ownerName: name,
                ssss: ssss, // SAVE SSSS
                updatedAt: serverTimestamp(),
            });

            setMessage(`CIN ${normalizedCin} has been ${isEditing ? 'updated' : 'added'} successfully.`);
            handleClearForm(); // Clear form after successful save

        } catch (error) {
            console.error("Error saving document:", error);
            setMessage(`Failed to save entry: ${error.message}`);
        }
    };

    const handleDeleteEntry = async (cin) => {
        if (!db || !userId) return;

        // Use a custom confirmation modal component instead of window.confirm
        const isConfirmed = await showCustomConfirmation(`Are you sure you want to permanently delete CIN ${cin}?`);

        if (isConfirmed) {
            try {
                const docRef = doc(db, 'artifacts', appId, 'users', userId, 'cin_registry', cin);
                await deleteDoc(docRef);
                setMessage(`CIN ${cin} deleted.`);
            } catch (error) {
                console.error("Error deleting document:", error);
                setMessage(`Failed to delete entry: ${error.message}`);
            }
        }
    };
    
    // --- LOOKUP HANDLERS (using in-memory search on the real-time data) ---

    const handleLookup = (e) => {
        e.preventDefault();
        const normalizedQuery = normalizeCIN(searchQuery);
        
        const found = registry.find(item => item.cin === normalizedQuery);
        
        if (found) {
            setLookupResult({
                status: 'Found',
                name: found.ownerName,
                cin: found.cin,
                ssss: found.ssss, // INCLUDE SSSS IN LOOKUP RESULT
            });
        } else {
            setLookupResult({
                status: 'Not Found',
                name: null,
                cin: normalizedQuery,
                ssss: null,
            });
        }
    };
    
    // --- CUSTOM CONFIRMATION MODAL STATE ---
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        message: '',
        onConfirm: () => {},
    });

    const showCustomConfirmation = (message) => {
        return new Promise(resolve => {
            setConfirmModal({
                isOpen: true,
                message,
                onConfirm: (result) => {
                    setConfirmModal({ isOpen: false, message: '', onConfirm: () => {} });
                    resolve(result);
                }
            });
        });
    };
    
    // --- RENDER HELPERS ---
    
    // Custom Input component with the monospace font for CIN
    const CinInput = ({ value, onChange, placeholder, disabled=false }) => (
        <input
            type="text"
            className="w-full p-3 border border-gray-300 rounded-lg text-lg font-mono focus:border-blue-700"
            style={{ fontFamily: 'monospace', color: COLORS.text, borderColor: isEditing ? COLORS.accent : COLORS.primary }}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
        />
    );

    // Loading/Error Message
    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: COLORS.background }}>
                <div className="p-8 rounded-lg shadow-xl" style={{ backgroundColor: COLORS.cardBg }}>
                    <p className="text-xl font-bold" style={{ color: COLORS.primary, fontFamily: 'Lato, sans-serif' }}>
                        Connecting to CPRA Internal Registry...
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-8 min-h-screen" style={{ backgroundColor: COLORS.background }}>
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Belleza&family=Lato:wght@400;700&display=swap');
                h1, h2, h3 { font-family: 'Belleza', serif; font-weight: 400; }
                * { font-family: 'Lato', sans-serif; }
                .cin-table-header { color: ${COLORS.primary}; }
                .cin-entry { font-family: monospace; }
                .data-card { border-top: 4px solid ${COLORS.accent}; }
                .action-button { background-color: ${COLORS.primary}; transition: background-color 0.2s; }
                .action-button:hover { background-color: #003873; }
                .secondary-button { background-color: ${COLORS.accent}; transition: background-color 0.2s; }
                .secondary-button:hover { background-color: #660000; }
                .delete-button { background-color: ${COLORS.accent}; }
                .delete-button:hover { background-color: #cc0000; }
                .edit-button { background-color: ${COLORS.secondary}; }
                .edit-button:hover { background-color: #c99419; }
                `}
            </style>
            
            <div className="max-w-6xl mx-auto">
                <header className="text-center mb-10">
                    <h1 className="text-4xl sm:text-5xl mb-2" style={{ color: COLORS.accent }}>
                        CPRA Internal Citizen Registry
                    </h1>
                    <p className="text-lg text-gray-600">
                        Secure Data Management for The Principality of Hixolram (User ID: {userId.substring(0, 8)}...)
                    </p>
                </header>

                {/* Status Message */}
                {message && (
                    <div className={`p-3 rounded-lg text-center mb-6 font-bold text-sm ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {message}
                    </div>
                )}
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* LEFT COLUMN: Data Entry and Lookup */}
                    <div className="lg:col-span-1 space-y-8">
                        {/* 1. CIN/Owner Entry Form */}
                        <div className="p-6 rounded-xl shadow-lg data-card" style={{ backgroundColor: COLORS.cardBg }}>
                            <h2 className="text-2xl mb-4" style={{ color: COLORS.primary }}>
                                {isEditing ? 'Update Citizen Record' : 'New Citizen Entry'}
                            </h2>
                            <form onSubmit={handleSaveEntry} className="space-y-4">
                                <label className="block font-bold text-sm" style={{ color: COLORS.text }}>
                                    CIN (HIXM-XXXXXX-XXXXXX-XXXX)
                                    <CinInput 
                                        value={cinInput} 
                                        onChange={(e) => setCinInput(e.target.value)} 
                                        placeholder="HIXA-834927-105562-4398"
                                        disabled={isEditing} // CIN cannot be edited once saved (it's the document ID)
                                    />
                                    {isEditing && <p className="text-xs text-red-500 mt-1">CIN is fixed for editing mode.</p>}
                                </label>
                                <label className="block font-bold text-sm" style={{ color: COLORS.text }}>
                                    Owner Full Name
                                    <input 
                                        type="text" 
                                        className="w-full p-3 border border-gray-300 rounded-lg text-lg focus:border-blue-700"
                                        style={{ color: COLORS.text }}
                                        value={ownerNameInput} 
                                        onChange={(e) => setOwnerNameInput(e.target.value)} 
                                        placeholder="Johnathan P. Smith"
                                    />
                                </label>
                                {/* NEW SSSS INPUT */}
                                <label className="block font-bold text-sm" style={{ color: COLORS.text }}>
                                    SSSS (Secret Security Sequence/District Code)
                                    <input 
                                        type="text" 
                                        className="w-full p-3 border border-gray-300 rounded-lg text-lg font-mono focus:border-blue-700"
                                        style={{ color: COLORS.text }}
                                        value={ssssInput} 
                                        onChange={(e) => setSsssInput(e.target.value)} 
                                        placeholder="e.g., District Alpha or 01A"
                                    />
                                </label>
                                {/* END NEW SSSS INPUT */}
                                <div className="flex space-x-3 pt-2">
                                    <button 
                                        type="submit" 
                                        className="flex-1 action-button text-white p-3 rounded-lg font-bold shadow-md"
                                    >
                                        {isEditing ? 'Save Changes' : 'Add New Record'}
                                    </button>
                                    <button 
                                        type="button" 
                                        onClick={handleClearForm} 
                                        className="w-1/4 secondary-button text-white p-3 rounded-lg font-bold shadow-md"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </form>
                        </div>

                        {/* 2. CIN Lookup/Verification */}
                        <div className="p-6 rounded-xl shadow-lg data-card" style={{ backgroundColor: COLORS.cardBg }}>
                            <h2 className="text-2xl mb-4" style={{ color: COLORS.primary }}>
                                Owner Verification (Lookup)
                            </h2>
                            <form onSubmit={handleLookup} className="space-y-4">
                                <label className="block font-bold text-sm" style={{ color: COLORS.text }}>
                                    Search CIN
                                    <CinInput 
                                        value={searchQuery} 
                                        onChange={(e) => setSearchQuery(e.target.value)} 
                                        placeholder="Enter CIN to find owner"
                                    />
                                </label>
                                <button 
                                    type="submit" 
                                    className="w-full action-button text-white p-3 rounded-lg font-bold shadow-md"
                                >
                                    Verify Owner
                                </button>
                            </form>
                            
                            {/* Lookup Result Box */}
                            <div className="mt-5 p-4 rounded-lg border-2 border-dashed" style={{ borderColor: COLORS.secondary }}>
                                {lookupResult ? (
                                    lookupResult.status === 'Found' ? (
                                        <div className="text-center">
                                            <p className="text-xs text-gray-500">CIN: {lookupResult.cin}</p>
                                            <p className="text-2xl font-bold mt-1" style={{ color: 'green' }}>{lookupResult.name}</p>
                                            <p className="mt-2 text-sm font-semibold" style={{ color: COLORS.accent }}>
                                                SSSS: {lookupResult.ssss}
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-center font-bold text-red-600">Record Not Found.</p>
                                    )
                                ) : (
                                    <p className="text-center text-gray-500">Enter a CIN to perform verification.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Real-Time Registry List */}
                    <div className="lg:col-span-2">
                        <div className="p-6 rounded-xl shadow-lg data-card" style={{ backgroundColor: COLORS.cardBg }}>
                            <h2 className="text-2xl mb-4" style={{ color: COLORS.primary }}>
                                Full Citizen Registry ({registry.length} Entries)
                            </h2>
                            <div className="max-h-[600px] overflow-y-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="sticky top-0 bg-gray-50">
                                        <tr>
                                            <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider cin-table-header">
                                                Citizen ID Number (CIN)
                                            </th>
                                            <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider cin-table-header">
                                                Owner Name
                                            </th>
                                            {/* NEW HEADER FOR SSSS */}
                                            <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider cin-table-header">
                                                SSSS (Secret Seq.)
                                            </th>
                                            {/* END NEW HEADER */}
                                            <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-wider cin-table-header">
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {registry.map((entry) => (
                                            <tr key={entry.id} className="hover:bg-blue-50">
                                                <td className="px-3 py-3 whitespace-nowrap text-sm cin-entry font-semibold" style={{ color: COLORS.primary }}>
                                                    {entry.cin}
                                                </td>
                                                <td className="px-3 py-3 whitespace-nowrap text-sm font-medium" style={{ color: COLORS.text }}>
                                                    {entry.ownerName}
                                                </td>
                                                {/* NEW COLUMN DATA FOR SSSS */}
                                                <td className="px-3 py-3 whitespace-nowrap text-sm font-medium cin-entry" style={{ color: COLORS.accent }}>
                                                    {entry.ssss}
                                                </td>
                                                {/* END NEW COLUMN DATA */}
                                                <td className="px-3 py-3 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                                    <button 
                                                        onClick={() => handleEditEntry(entry)} 
                                                        className="edit-button text-white p-2 rounded-md shadow-sm text-xs"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDeleteEntry(entry.cin)} 
                                                        className="delete-button text-white p-2 rounded-md shadow-sm text-xs"
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {registry.length === 0 && (
                                    <div className="text-center p-10 text-gray-500 italic">
                                        The registry is empty. Add a new citizen record above.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            {/* Custom Confirmation Modal */}
            {confirmModal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-lg shadow-2xl max-w-sm mx-auto" style={{ borderTop: `5px solid ${COLORS.accent}` }}>
                        <p className="text-lg mb-6" style={{ color: COLORS.text }}>{confirmModal.message}</p>
                        <div className="flex justify-end space-x-3">
                            <button 
                                onClick={() => confirmModal.onConfirm(false)}
                                className="action-button px-4 py-2 text-white rounded-md text-sm"
                                style={{ backgroundColor: 'gray' }}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={() => confirmModal.onConfirm(true)}
                                className="secondary-button px-4 py-2 text-white rounded-md text-sm"
                            >
                                Confirm Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
