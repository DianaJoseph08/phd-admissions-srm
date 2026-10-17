'use strict';
const catalog = require('./trichy-admission-catalog.json');
const {departmentKey} = require('./admission-mapping');
function queueTrichyCatalog(db, onError = error => console.error('Trichy catalog update failed:', error.message)) {
    for (const institute of catalog.institutions) {
        db.run("UPDATE institutions SET name=?,dean_username=?,coord_username=?,coordinator=(SELECT name FROM users WHERE username=? AND role='coordinator' AND campus_id=2) WHERE id=? AND campus_id=2 AND EXISTS(SELECT 1 FROM users WHERE username=? AND role='dean' AND campus_id=2) AND EXISTS(SELECT 1 FROM users WHERE username=? AND role='coordinator' AND campus_id=2)", [institute.name,catalog.routing.dean_username,catalog.routing.coord_username,catalog.routing.coord_username,institute.id,catalog.routing.dean_username,catalog.routing.coord_username], error => {if(error)onError(error)});
        for (const name of institute.departments) {
            const aliases = departmentKey(name) === departmentKey('Anesthesia Technology') ? [name, 'Anaesthesia Technology'] : [name];
            db.run('UPDATE departments SET name = ? WHERE institution_id = ? AND UPPER(name) IN (' + aliases.map(()=>'?').join(',') + ')', [name, institute.id, ...aliases.map(n=>n.toUpperCase())], error => {if(error)onError(error)});
            db.run('INSERT INTO departments (institution_id,name) SELECT ?,? WHERE EXISTS (SELECT 1 FROM institutions WHERE id=? AND campus_id=2) AND NOT EXISTS (SELECT 1 FROM departments WHERE institution_id=? AND UPPER(name)=UPPER(?))', [institute.id,name,institute.id,institute.id,name], error => {if(error)onError(error)});
        }
    }
}
module.exports = {catalog,queueTrichyCatalog};
