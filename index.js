/*
 * Copyright 2021 Daniel Ostrowski
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const newman = require("newman");

// See https://schema.postman.com/ for a documentation on the format of Collections.
// At this time only "v2.1.0" Collections are explicitly supported
const originalCollection = require("./sample.postman_collection.json");
const originalInfo = originalCollection.info;
const originalItem = originalCollection.item;

// Make sure the specified file at least seems like a Postman Collection
if (originalInfo === undefined) {
    throw new Error("The specified Collection is invalid because it lacks a top-level `info` object");
}
if (originalItem === undefined) {
    throw new Error("The specified Collection is invalid because it lacks a top-level `item` array");
}
// At this time, it is expected that every top-level item is a folder
const originalTopLevelFolders = originalItem.filter(child => child.item !== undefined);
const originalTopLevelRequests = originalItem.filter(child => !originalTopLevelFolders.includes(child));
if (originalTopLevelRequests.length > 0) {
    throw new Error("The specified Collection has individual top-level requests which is not supported. All top-level items in the Collection must be folders at this time");    
}
// A Collection is a folder with an `info` object. Give each folder an info object
// based on the original Collection's info object.
originalTopLevelFolders.forEach((folder, index) => folder.info = {
    ...originalInfo,
    name: originalInfo.name + " " + (folder.name || index + 1),
    originalIndex: index
});
// Run each top-level folder simultaneously as if it were a Collection, then summarize and print
// the results
const results = [];
const folderExecutionPromises = originalTopLevelFolders.map(folder => new Promise((resolve, reject) => 
    newman.run({
        collection: folder,
        reporter: 'json'
    }, (err, summary) => {
        if (err) {
            reject(err);
        }
        results.push({ index: folder.info.originalIndex, summary });
        resolve(summary);
})));
Promise.all(folderExecutionPromises).then((response) => aggregateResults()).catch((error) => console.log(error));

// Orders all the results as if the entire original Collection were executed traditionally, then print any
// error messages
function aggregateResults() {
    // Every item in `results` is the JSON result provided by Newman of running a particular top-level folder,
    // along with the index of that folder in the original collection
    // Put the results in the order in which they appeared in the original Collection
    results.sort((resultA, resultB) => resultA.index - resultB.index);
    for (var result of results) {
        const requests = result.summary.run.executions;
        // I have not yet found where the format for the JSON reporter in Newman is documented.
        // The structure of the output is different when converted to JSON, so the easiest way
        // to work with it was to dump the JSON to a file as a reference. Convert the `collection`
        // property to a "Plain Old JavaScript Object" so the structure is the same as when dumped
        // to a file.
        const plainCollection = JSON.parse(JSON.stringify(result.summary.collection));
        plainCollection.name = result.summary.collection.name;
        for (var request of requests) {
            const failures = request.assertions.filter(assertion => assertion.error !== undefined);
            if (failures.length > 0) {
                const pathToRequest = getPathToTest(plainCollection, request.id, []);
                pathToRequest.push(request.item.name);
                console.log(pathToRequest.join(" / "));
                console.log(failures);
            }
        }
    }
}

// At runtime, every folder and request in JSON reporter's output has an id property
// generated for it. `run.executions` in the reporter's output is a "flat" list, so
// to know the "full path" to the Postman request that an error corresponds to, perform
// a depth-first-search on the copy of the Collection included in the reporter's output
// to find the specified request by its autogenerated id
function getPathToTest(folder, requestId, currentPath) {
    for (var item of folder.item) {
        // If this child of the folder is the request with the desired id
        if (item.id === requestId) {
            return [...currentPath, folder.name];
        }
        // If this child of the folder is a subfolder
        if (item.item !== undefined) {
            // Search the whole subfolder
            const dfsResult = getPathToTest(item, requestId, [...currentPath, folder.name]);
            // If the desired request was found, propagate that result upward
            if (dfsResult !== null) {
                return dfsResult;
            }
        }
    }
    return null;
}